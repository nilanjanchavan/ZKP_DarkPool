pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";

template KYCVerifier() {
    signal input userPrivateKey;
    signal input orderNonce;
    signal input expectedNullifier;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== userPrivateKey;
    hasher.inputs[1] <== orderNonce;

    expectedNullifier === hasher.out;
}

component main { public [ expectedNullifier ] } = KYCVerifier();
