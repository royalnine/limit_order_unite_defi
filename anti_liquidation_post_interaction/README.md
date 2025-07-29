# Anti-Liquidation Post Interaction Contract

This project contains a Solidity smart contract for handling post-interaction logic to prevent liquidations in DeFi protocols.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Compile contracts:
```bash
npm run compile
```

## Development

### Running Tests
```bash
npm test
```

### Starting Anvil
In a separate terminal, start anvil:
```bash
anvil
```

### Deploying to Anvil
```bash
npm run deploy:anvil
```

### Other Commands
- `npm run clean` - Clean build artifacts
- `npm run node` - Start Hardhat node

## Contract Overview

The `AntiLiquidationPostInteraction` contract provides:

- **Authorization System**: Only authorized callers can execute post interactions
- **Post Interaction Logic**: Extensible framework for implementing anti-liquidation strategies
- **Emergency Recovery**: Owner can recover stuck tokens
- **Event Logging**: All interactions are logged for monitoring

## Usage

1. Deploy the contract
2. Authorize relevant protocol contracts or addresses
3. Implement your specific anti-liquidation logic in the `executePostInteraction` function
4. Call the function from authorized contracts during protocol interactions

## Security Features

- **Access Control**: Only authorized addresses can execute interactions
- **Reentrancy Protection**: All external calls are protected against reentrancy
- **Owner Controls**: Emergency functions and authorization management

## Network Configuration

The project is configured for:
- **Anvil**: Local development (http://127.0.0.1:8545)
- **Hardhat Network**: Built-in testing network
- **Localhost**: Alternative local network

## Next Steps

1. Implement your specific anti-liquidation logic
2. Add integration with your target DeFi protocols
3. Add comprehensive tests for your use cases
4. Configure additional networks as needed 