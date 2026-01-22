pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Soulbound ERC-1155 for Stream402 memberships.
/// - Mint/burn by owner (server-side minter wallet).
/// - Transfers disabled (only mint + burn).
contract Stream402Membership1155 is ERC1155, Ownable {
  constructor(string memory uri_) ERC1155(uri_) Ownable(msg.sender) {}

  function mint(address to, uint256 id, uint256 amount, bytes calldata data) external onlyOwner {
    _mint(to, id, amount, data);
  }

  function burn(address from, uint256 id, uint256 amount) external onlyOwner {
    _burn(from, id, amount);
  }

  function _update(
    address from,
    address to,
    uint256[] memory ids,
    uint256[] memory values
  ) internal override {
    // Soulbound: allow mint (from=0) and burn (to=0) only.
    if (from != address(0) && to != address(0)) revert("SBT");
    super._update(from, to, ids, values);
  }
}

