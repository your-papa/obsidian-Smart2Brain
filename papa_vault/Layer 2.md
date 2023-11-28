---
related:
- "[[Web3]]"
created_at:  "16-11-2022 11:13"
---
Related: [[Web3]]


# Scaling Solutions
---
-> Increasing Transaction spead by reducing congestion on Mainnet
- Transactions are batched into a single transaction to Mainnet 
-> reduces Gas fees

## Sharding
- On Chain, altering Ethereum protocol
- Splitting database (chain) horizontally to spread the load
- Sacrifices security

## On-Chain
---
### ZK-Rollups (zk-validity proof, on chain)
- Batch together transactions off-chain and write the validity proof ([[Zero Knowledge Proofs]] merkle root hash) to the chain
-> Transaction fee is split across multiple transactions
![[image (14).png|350]]

### Optimistic Rollups (fraud proof, on-chain)
Assumes transactions in a batch are valid by default and only runs computation via a fraud proof (checks if a transaction in a rollup is valid)
![[image (15).png]]

## Off-Chain
---
### Validium (zk-validity proof, off-chain)
- uses validity proofs and stores them offchain

### Plasma (fraud proof, off-chain)
Childchains in Tree structure
![[image (13).png]]
- Similar to Optimistic Rollups, fraud proofs are used if the Merkle tree root is wrong
- Difference: Data is not on-chain -> problem with data availability
- Operator refusing to publish data would lead to a mass exit, congesting L1?
- no general computation, only token transfers

### Sidechains
- Outsource work to another chain
- Sidechain cannot exist without mainchain
- Sidechain has own consensus protocol -> faster more affordable
- Periodically submit aggregation of recent block back to mainchain

### State/Payment Channels
Lock up funds and trade with virtual funds
1. multisig contracts enables participants to transact quickly off-chain
2. then settle finality on Mainnet
![[Pasted image 20221117143318.png]]

## Overview
| Scaling Solution   | Advantage                                                                                                               | Disadvantage                                                                                     | Transaction Cost |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------- |
| ZK-Rollups         | offers much more significant savings on transaction costs and faster transactions                                       | The scope of transactions on ZK- Rollups is limited and does not reach beyond that limit         | $0.01            |
| Optimistic Rollups | offer users much cheaper transactions costs                                                                             | have limited through put on transactions                                                         | $0.2             |
| Plasma             | enables fast and cheap transactions by off-loading transactions away from the main Ethereum blockchain into a sidechain | delays the withdrawal of transaction funds by a week                                             | 0.15$            |
| Sidechains         | provide users with cheaper transaction costs and faster transactions across networks                                    | the main Ethereum chain does not secure the transactions on Sidechains due to separate consensus | $0.15            |
| State Channels     | allow instant fee-less payments to be sent directly between two parties after transactions are completed                | Transaction costs are expensive, and the network often delays transactions                       | $1.0             |


# Final Overview
---
![[Pasted image 20221116164734.png]]