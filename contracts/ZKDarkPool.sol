// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";

interface IZKVerifier {
    function verifyProof(bytes memory proof, uint256[] memory publicInputs) external view returns (bool);
}

/**
 * @title ZKDarkPool
 * @notice Multi-asset dark pool. A user lists an order to sell `tokenIn` and
 *         receive `tokenOut` in return (address(0) denotes native ETH). Orders
 *         are only matched against complementary pairs — A.tokenIn == B.tokenOut
 *         and A.tokenOut == B.tokenIn — whose USD values (from the respective
 *         Chainlink feeds) agree within a small tolerance.
 */
contract ZKDarkPool is AutomationCompatible, ReentrancyGuard, Pausable, Ownable {
    struct Order {
        uint256 id;
        address trader;
        address tokenIn; // token being sold; address(0) = native ETH
        address tokenOut; // token requested in return; address(0) = native ETH
        uint256 amountIn; // amount of tokenIn deposited
        bool active;
    }

    IZKVerifier public zkVerifier;
    address public automationRegistry;
    mapping(address => AggregatorV3Interface) public priceFeeds;

    mapping(uint256 => bool) public nullifiersUsed;
    Order[] public orders;

    /// @dev Maximum permitted relative value deviation between matched orders
    ///      (1% expressed in 1e18 units).
    uint256 public constant MATCH_TOLERANCE = 1e16;

    event OrderSubmitted(
        uint256 indexed orderId,
        address indexed trader,
        uint256 nullifier,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    );
    event OrderExecuted(uint256 indexed orderId, address indexed trader, uint256 amountIn, uint256 fillPriceUSD);
    event OrderMatched(uint256 indexed orderAId, uint256 indexed orderBId, uint256 priceA, uint256 priceB);
    event VerifierUpdated(address indexed verifier);
    event AutomationRegistryUpdated(address indexed registry);
    event PriceFeedUpdated(address indexed token, address indexed feed);

    error InvalidPrice();
    error InvalidProof();
    error ZeroAmount();
    error SameToken();
    error IncorrectEthValue();
    error UnsupportedToken();

    constructor(
        address _ethUsdFeed,
        address _linkUsdFeed,
        address _linkToken,
        address _zkVerifier,
        address _automationRegistry
    ) Ownable(msg.sender) {
        zkVerifier = IZKVerifier(_zkVerifier);
        automationRegistry = _automationRegistry;

        // address(0) is the key for native ETH; the LINK token maps to LINK/USD.
        if (_ethUsdFeed != address(0)) priceFeeds[address(0)] = AggregatorV3Interface(_ethUsdFeed);
        if (_linkUsdFeed != address(0)) priceFeeds[_linkToken] = AggregatorV3Interface(_linkUsdFeed);
    }

    function ordersCount() external view returns (uint256) {
        return orders.length;
    }

    function setVerifier(address _zkVerifier) external onlyOwner {
        zkVerifier = IZKVerifier(_zkVerifier);
        emit VerifierUpdated(_zkVerifier);
    }

    function setAutomationRegistry(address _automationRegistry) external onlyOwner {
        automationRegistry = _automationRegistry;
        emit AutomationRegistryUpdated(_automationRegistry);
    }

    function setPriceFeed(address _token, address _feed) external onlyOwner {
        priceFeeds[_token] = AggregatorV3Interface(_feed);
        emit PriceFeedUpdated(_token, _feed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice ETH/USD in 18-decimal fixed point (kept for backward compat).
    function getLatestPrice() public view returns (uint256) {
        return _readPrice(priceFeeds[address(0)]);
    }

    /// @notice USD price of `token` in 18-decimal fixed point.
    function getTokenPrice(address token) public view returns (uint256) {
        return _readPrice(priceFeeds[token]);
    }

    function _readPrice(AggregatorV3Interface feed) internal view returns (uint256) {
        if (address(feed) == address(0)) revert UnsupportedToken();
        (, int256 price, , , ) = feed.latestRoundData();
        if (price <= 0) revert InvalidPrice();
        return uint256(price) * 1e10;
    }

    /**
     * @notice Lists an order selling `amountIn` of `tokenIn` for `tokenOut`.
     * @dev Deposits the sold asset: native ETH via msg.value, ERC-20s via
     *      transferFrom. `publicInputs` are [nullifier, amountIn, tokenIn, tokenOut].
     */
    function submitOrder(
        bytes calldata proof,
        uint256 nullifier,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external payable whenNotPaused nonReentrant returns (uint256 orderId) {
        if (amountIn == 0) revert ZeroAmount();
        if (tokenIn == tokenOut) revert SameToken();

        uint256[] memory publicInputs = new uint256[](4);
        publicInputs[0] = nullifier;
        publicInputs[1] = amountIn;
        publicInputs[2] = uint256(uint160(tokenIn));
        publicInputs[3] = uint256(uint160(tokenOut));
        if (!zkVerifier.verifyProof(proof, publicInputs)) revert InvalidProof();
        require(!nullifiersUsed[nullifier], "Nullifier already used");
        nullifiersUsed[nullifier] = true;

        if (tokenIn == address(0)) {
            if (msg.value != amountIn) revert IncorrectEthValue();
        } else {
            require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "DepositFailed");
        }

        orderId = orders.length;
        Order storage order = orders.push();
        order.id = orderId;
        order.trader = msg.sender;
        order.tokenIn = tokenIn;
        order.tokenOut = tokenOut;
        order.amountIn = amountIn;
        order.active = true;

        emit OrderSubmitted(orderId, msg.sender, nullifier, tokenIn, tokenOut, amountIn);
    }

    function checkUpkeep(bytes calldata checkData)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        if (paused()) return (false, bytes(""));

        if (checkData.length > 0) {
            (uint256 orderAId, uint256 orderBId) = abi.decode(checkData, (uint256, uint256));
            if (_isMatchablePair(orderAId, orderBId)) return (true, abi.encode(orderAId, orderBId));
            return (false, bytes(""));
        }

        for (uint256 i = 0; i < orders.length; i++) {
            for (uint256 j = i + 1; j < orders.length; j++) {
                if (!_isMatchablePair(i, j)) continue;
                return (true, abi.encode(i, j));
            }
        }
        return (false, bytes(""));
    }

    /// @notice Executes a matched pair. No caller restriction: the demo runs
    ///         the local matcher wallet (run-matcher.ts) which calls this
    ///         directly. The CRE adapter / chainlink automation remains wired
    ///         via `automationRegistry` but is no longer required to trigger.
    function performUpkeep(bytes calldata performData) external override whenNotPaused nonReentrant {
        (uint256 orderAId, uint256 orderBId) = abi.decode(performData, (uint256, uint256));
        _executePair(orderAId, orderBId);
    }

    function _executePair(uint256 orderAId, uint256 orderBId) internal {
        if (orderAId >= orders.length || orderBId >= orders.length) return;
        if (!_isMatchablePair(orderAId, orderBId)) return;

        Order storage orderA = orders[orderAId];
        Order storage orderB = orders[orderBId];

        uint256 priceA = getTokenPrice(orderA.tokenIn);
        uint256 priceB = getTokenPrice(orderB.tokenIn);

        orderA.active = false;
        orderB.active = false;

        // A.tokenIn == B.tokenOut and A.tokenOut == B.tokenIn, so each trader
        // receives the counterparty's deposited asset.
        _transferToken(orderA.tokenIn, orderB.trader, orderA.amountIn);
        _transferToken(orderB.tokenIn, orderA.trader, orderB.amountIn);

        emit OrderExecuted(orderAId, orderA.trader, orderA.amountIn, priceA);
        emit OrderExecuted(orderBId, orderB.trader, orderB.amountIn, priceB);
        emit OrderMatched(orderAId, orderBId, priceA, priceB);
    }

    function _isMatchablePair(uint256 orderAId, uint256 orderBId) internal view returns (bool) {
        if (orderAId >= orders.length || orderBId >= orders.length) return false;
        Order storage orderA = orders[orderAId];
        Order storage orderB = orders[orderBId];
        if (!orderA.active || !orderB.active) return false;
        if (orderA.trader == orderB.trader) return false; // no self-matching
        if (orderA.tokenIn == orderA.tokenOut) return false; // degenerate pair
        if (orderA.tokenIn != orderB.tokenOut) return false;
        if (orderA.tokenOut != orderB.tokenIn) return false;

        uint256 valueA = (orderA.amountIn * getTokenPrice(orderA.tokenIn)) / 1e18;
        uint256 valueB = (orderB.amountIn * getTokenPrice(orderB.tokenIn)) / 1e18;
        return _withinTolerance(valueA, valueB);
    }

    function _withinTolerance(uint256 valueA, uint256 valueB) internal pure returns (bool) {
        if (valueA == 0 || valueB == 0) return false;
        uint256 diff = valueA > valueB ? valueA - valueB : valueB - valueA;
        return diff * 1e18 <= ((valueA + valueB) / 2) * MATCH_TOLERANCE;
    }

    function _transferToken(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = payable(to).call{value: amount}("");
            require(ok, "ETHTransferFailed");
        } else {
            require(IERC20(token).transfer(to, amount), "ERC20TransferFailed");
        }
    }
}
