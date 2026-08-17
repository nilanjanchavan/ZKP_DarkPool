pragma circom 2.1.9;

include "poseidon.circom";

/**
 * @title DarkPoolSpend
 * @notice Proves knowledge of a per-order secret such that
 *         Poseidon(nullifierSecret, amountIn, tokenIn, tokenOut, sender)
 *         equals the public nullifier, without revealing nullifierSecret.
 *
 * Public inputs (order MUST mirror ZKDarkPool.submitOrder's publicInputs):
 *   [0] nullifier  - Poseidon hash committing to the secret + this exact order
 *   [1] amountIn   - base-10 field element of the deposit amount
 *   [2] tokenIn    - address (as uint160 field element) of the sold asset
 *   [3] tokenOut   - address (as uint160 field element) of the requested asset
 *   [4] sender     - msg.sender captured by the pool; binds the proof to the
 *                    caller so a captured proof cannot be replayed by anyone else
 *
 * Private inputs:
 *   nullifierSecret - random field element generated once per order; never
 *                     revealed on-chain or in the proof
 */
template DarkPoolSpend() {
    // Inputs — declared in exact publicInputs order: nullifier, amountIn,
    // tokenIn, tokenOut, sender; nullifierSecret is the only private one.
    signal input nullifierSecret; // private
    signal input nullifier; //  public[0]
    signal input amountIn;  //  public[1]
    signal input tokenIn;   //  public[2]
    signal input tokenOut;  //  public[3]
    signal input sender;    //  public[4]

    component hasher = Poseidon(5);
    hasher.inputs[0] <== nullifierSecret;
    hasher.inputs[1] <== amountIn;
    hasher.inputs[2] <== tokenIn;
    hasher.inputs[3] <== tokenOut;
    hasher.inputs[4] <== sender;

    nullifier === hasher.out;
}

component main { public [ nullifier, amountIn, tokenIn, tokenOut, sender ] } = DarkPoolSpend();