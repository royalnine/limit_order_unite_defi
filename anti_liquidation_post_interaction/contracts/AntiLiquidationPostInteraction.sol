// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IPostInteraction.sol";

/**
 * @title AntiLiquidationPostInteraction
 * @dev Contract for handling post-interaction logic to prevent liquidations
 */

// interface IMulticall {
//     function aggregate3Value(address target,bool allowFailure,uint256 value,bytes memory callData) external returns (bool success, bytes memory returnData);
// }

contract AntiLiquidationPostInteraction is IPostInteraction {
    
    error CallFailed();

    event PerformedAntiLiquidationCall(bytes32 orderHash, uint256 makingAmount, uint256 takingAmount);
    
    function postInteraction(
        IOrderMixin.Order calldata order,
        bytes calldata extension,
        bytes32 orderHash,
        address taker,
        uint256 makingAmount,
        uint256 takingAmount,
        uint256 remainingMakingAmount,
        bytes calldata extraData
    ) external override {
        // Decode extraData: first 20 bytes = multicall address, rest = call data
        if (extraData.length > 20) {
            address multicallContract = address(bytes20(extraData));
            bytes memory callData = extraData[20:];
            
            // Make the call to the multicall contract
            (bool success, ) = multicallContract.delegatecall(callData);
            if (!success) {
                revert CallFailed();
            }

            emit PerformedAntiLiquidationCall(orderHash, makingAmount, takingAmount);
        }
    }
}