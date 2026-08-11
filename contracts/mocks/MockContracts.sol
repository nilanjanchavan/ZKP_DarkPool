// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockZKVerifier {
    mapping(uint256 => bool) public nullifiers;
    bool public shouldVerify;

    mapping(bytes32 => bool) public validProofs;

    event NullifierMarked(uint256 indexed nullifier);

    constructor() {
        shouldVerify = true;
    }

    function setShouldVerify(bool _shouldVerify) external {
        shouldVerify = _shouldVerify;
    }

    function registerValidProof(bytes32 _proofHash) external {
        validProofs[_proofHash] = true;
    }

    function verifyProof(bytes memory proof, uint256[] memory publicInputs) external view returns (bool) {
        if (!shouldVerify) return false;
        bytes32 proofHash = keccak256(abi.encode(proof, publicInputs));
        if (validProofs[proofHash]) return true;
        return publicInputs.length == 4;
    }

    function isNullifierUsed(uint256 nullifier) external view returns (bool) {
        return nullifiers[nullifier];
    }

    function markNullifierUsed(uint256 nullifier) external {
        nullifiers[nullifier] = true;
        emit NullifierMarked(nullifier);
    }
}

contract MockPriceFeed {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public decimals_;

    constructor() {
        decimals_ = 8;
        answer = 300000000000; // 3000.00000000 USD
        updatedAt = block.timestamp;
    }

    function setAnswer(int256 _answer) external {
        answer = _answer;
        updatedAt = block.timestamp;
    }

    function setDecimals(uint8 _decimals) external {
        decimals_ = _decimals;
    }

    function setUpdatedAt(uint256 _updatedAt) external {
        updatedAt = _updatedAt;
    }

    function decimals() external view returns (uint8) {
        return decimals_;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, answer, updatedAt, updatedAt, 1);
    }

    function description() external pure returns (string memory) {
        return "ETH / USD";
    }

    function version() external pure returns (uint256) {
        return 4;
    }

    function getRoundData(uint80)
        external
        pure
        returns (uint80, int256, uint256, uint256, uint80)
    {
        revert("not supported");
    }
}
