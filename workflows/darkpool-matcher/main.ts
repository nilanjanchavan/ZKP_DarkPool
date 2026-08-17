import {
  CronCapability,
  EVMClient,
  getNetwork,
  handler,
  Runner,
  encodeCallMsg,
  bytesToHex,
  hexToBase64,
  LAST_FINALIZED_BLOCK_NUMBER,
  TxStatus,
  type Runtime,
} from "@chainlink/cre-sdk";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  zeroAddress,
} from "viem";
import { z } from "zod";

import { AggregatorV3InterfaceAbi, ZKDarkPoolAbi } from "./contracts/abi/ZKDarkPool";

const configSchema = z.object({
  schedule: z.string(),
  chainSelectorName: z.string(),
  priceFeedAddress: z.string(),
  darkPoolAddress: z.string(),
  receiverAddress: z.string(),
  forwarderAddress: z.string(),
  gasLimit: z.string(),
});

type Config = z.infer<typeof configSchema>;

const ORACLE_PRECISION_MULTIPLIER = 10n ** 10n;

function getEvmClient(runtime: Runtime<Config>): EVMClient {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
  });
  if (!network) {
    throw new Error(`Network not found: ${runtime.config.chainSelectorName}`);
  }
  return new EVMClient(network.chainSelector.selector);
}

function readEthUsdPrice(runtime: Runtime<Config>): bigint {
  const evmClient = getEvmClient(runtime);

  const callData = encodeFunctionData({
    abi: AggregatorV3InterfaceAbi,
    functionName: "latestRoundData",
  });

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: runtime.config.priceFeedAddress as Address,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  const [roundId, answer, , updatedAt] = decodeFunctionResult({
    abi: AggregatorV3InterfaceAbi,
    functionName: "latestRoundData",
    data: bytesToHex(contractCall.data),
  }) as [bigint, bigint, bigint, bigint, bigint];

  if (answer <= 0n) {
    throw new Error(`Non-positive price answer (round ${roundId})`);
  }

  const price18 = BigInt(answer) * ORACLE_PRECISION_MULTIPLIER;
  runtime.log(`ETH/USD = ${price18.toString()} (1e18) at round ${roundId}, updated ${updatedAt}`);
  return price18;
}

function queryCheckUpkeep(runtime: Runtime<Config>): { upkeepNeeded: boolean; performData: Hex } {
  const evmClient = getEvmClient(runtime);

  const callData = encodeFunctionData({
    abi: ZKDarkPoolAbi,
    functionName: "checkUpkeep",
    args: ["0x"],
  });

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: runtime.config.darkPoolAddress as Address,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  const [upkeepNeeded, performData] = decodeFunctionResult({
    abi: ZKDarkPoolAbi,
    functionName: "checkUpkeep",
    data: bytesToHex(contractCall.data),
  }) as [boolean, Hex];

  runtime.log(`checkUpkeep => upkeepNeeded=${upkeepNeeded}, performData=${performData}`);
  return { upkeepNeeded, performData };
}

function submitPerformUpkeep(runtime: Runtime<Config>, performData: Hex): string {
  const evmClient = getEvmClient(runtime);

  const callData = encodeFunctionData({
    abi: ZKDarkPoolAbi,
    functionName: "performUpkeep",
    args: [performData],
  });

  const reportResponse = runtime
    .report({
      encodedPayload: hexToBase64(callData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: runtime.config.receiverAddress as Address,
      report: reportResponse,
      gasConfig: {
        gasLimit: runtime.config.gasLimit,
      },
    })
    .result();

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`performUpkeep tx failed with status: ${writeResult.txStatus}`);
  }

  const txHash = bytesToHex(writeResult.txHash ?? new Uint8Array(32));
  runtime.log(`performUpkeep submitted: https://sepolia.etherscan.io/tx/${txHash}`);
  return txHash;
}

const onCronTrigger = (runtime: Runtime<Config>): { price18: string; upkeepNeeded: boolean; txHash?: string } => {
  const price18 = readEthUsdPrice(runtime);

  const { upkeepNeeded, performData } = queryCheckUpkeep(runtime);
  if (!upkeepNeeded) {
    runtime.log("No matchable dark pool orders at current price; skipping.");
    return { price18: price18.toString(), upkeepNeeded: false };
  }

  const txHash = submitPerformUpkeep(runtime, performData);
  return { price18: price18.toString(), upkeepNeeded: true, txHash };
};

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [
    handler(
      cron.trigger({
        schedule: config.schedule,
      }),
      onCronTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
