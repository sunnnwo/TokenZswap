// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// OpenZeppelin ERC20 standard implementation
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// ERC20Permit adds gasless approval via EIP-2612 signatures
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
// Ownable provides access control, allowing only the owner to perform certain actions
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SunWoo42
 * @notice Test ERC-20 token used as Token A of the TokenZswap AMM pool.
 *         Deployed on BNB Smart Chain testnet and Ethereum Sepolia testnet.
 *         Ticker: SW42  |  Decimals: 18 (ERC20 default)
 *
 * Token name contains "42" as required by the tokenizer project specification.
 *
 * Supply model (supply is NOT fixed):
 *   - initialSupply is minted to the deployer once, at deployment.
 *   - Anyone can call faucet() to receive FAUCET_AMOUNT, at most once per FAUCET_COOLDOWN.
 *   - The owner can call mint() to create any amount for any address.
 *
 * Security notes (testnet only, not intended for production):
 *   - The owner can mint without limit. Whoever holds the owner key controls the supply,
 *     and therefore the price of SW42 in any AMM pool.
 *   - The faucet cooldown is tracked per address. Creating new wallets bypasses it;
 *     this is accepted because the token has no real value.
 *   - ERC20Permit (EIP-2612) lets holders sign off-chain approvals,
 *     eliminating the need for a separate on-chain approve transaction.
 */
contract SunWoo42 is ERC20, ERC20Permit, Ownable {
    /// @notice Amount of tokens dispensed by the faucet (in wei units, 18 decimals).
    uint256 public constant FAUCET_AMOUNT = 1_000 * 10 ** 18;

    /// @notice Cooldown period between faucet claims (in seconds).
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    /// @notice Timestamp (unix seconds) of the last faucet claim per address; 0 if never claimed.
    mapping(address => uint256) public lastFaucetClaim;

    /// @notice Emitted when an address receives tokens from the faucet.
    event FaucetClaimed(address indexed recipient, uint256 amount);

    /**
     * @notice Deploys the token, makes the deployer the owner and mints the initial supply to them.
     * @param initialSupply Total tokens minted to the deployer (wei units, 18 decimals).
     *                      Example: pass 1_000_000 * 10**18 for 1,000,000 SW42.
     */

    constructor(uint256 initialSupply)
        ERC20("SunWoo42", "SW42") // token name and ticker symbol
        ERC20Permit("SunWoo42") // domain separator for EIP-2612
        Ownable(msg.sender) // sets the deployer as the initial owner

    {
        _mint(msg.sender, initialSupply);
    }
    /**
     * @notice Mints FAUCET_AMOUNT to the caller. Callable by anyone, once per FAUCET_COOLDOWN.
     * @dev block.timestamp can be skewed by validators by a few seconds; negligible for a 1-day cooldown.
     */

    function faucet() external {
        require(block.timestamp >= lastFaucetClaim[msg.sender] + FAUCET_COOLDOWN, "Faucet cooldown: 1 day");
        lastFaucetClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /**
     * @notice Mints a specified amount of tokens to a given address. Callable only by the contract owner.
     * @param to address that will receive the newly minted tokens
     * @param amount Number of tokens to mint (in wei units, 18 decimals)
     * @dev There is no cap: this is the main centralization point of the token.
     *      Used to seed AMM liquidity and to top up evaluation wallets.
     */

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
