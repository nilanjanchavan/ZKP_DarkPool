// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Groth16Verifier} from "./Verifier.sol";

/**
 * @title SnarkVerifierAdapter
 * @notice Bridges snarkjs's generated Groth16Verifier to the ZK interface the
 *         pool was written against, WITHOUT changing any pool function
 *         signature.
 *
 * The pool calls `verifier.verifyProof(bytes proof, uint256[] publicInputs)`.
 * snarkjs verifiers expose `verifyProof(uint[2] pA, uint[2][2] pB, uint[2]
 * pC, uint[N] pubSignals)`. This contract decodes `proof` (ABI-encoded as
 * (uint256[2], uint256[2][2], uint256[2]) in that order) and forwards the
 * five public signals unchanged: [nullifier, amountIn, tokenIn, tokenOut,
 * sender].
 *
 * The public-signal order in the circuit (main { public [... ] }) and the
 * pool's publicInputs[] construction must stay in lockstep; both are
 * [nullifier, amountIn, tokenIn, tokenOut, sender].
 */
contract SnarkVerifierAdapter {
    Groth16Verifier public immutable verifier;

    constructor(address _verifier) {
        verifier = Groth16Verifier(_verifier);
    }

    /// @dev Matches IZKVerifier.verifyProof(bytes, uint256[]) selector.
    function verifyProof(bytes calldata proof, uint256[] calldata publicInputs)
        external
        view
        returns (bool)
    {
        if (publicInputs.length != 5) return false;

        (uint256[2] memory pA, uint256[2][2] memory pB, uint256[2] memory pC) =
            abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));

        uint256[5] memory signals;
        for (uint256 i = 0; i < 5; i++) {
            signals[i] = publicInputs[i];
        }

        return verifier.verifyProof(pA, pB, pC, signals);
    }
}