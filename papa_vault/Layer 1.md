---
related:
- "[[Web3]]"
created_at:  "16-11-2022 11:12"
---
Related: [[Web3]]

# Blockchain
---
![[Pasted image 20221114104218.png|500]]

# Distributed Blockchain
---
== Timestamp server -> pin immutable digital information to a certain point in (digital) time
Made possible by the following decentralized consensus mechanisms:
## Proof of Work
## Proof of Stake
## Proof of History

# Distributed Ledgers
---
- build transaction system ontop of timestamping
- timestamping is essential for ordering all transactions
- Each Block contains number of transactions which are signed by an asymmetrical key also called wallet. 
- Whole chain represents a ledger which was build and agreed on by thousands of nodes through an consensus mechanism (Proof of Work/Stake)

## Transaction
Source: Issued by an Account/Wallet
Destination: Other Wallet or Smart Contract Address (Message Calls) or create Smart Contract (Contract Creation)
**On bitcoin:**
![[Pasted image 20221229151936.png]]

# Distributed State Machine
---
Builds on top or is part of distributed ledgers

E.g.: Ethereum Virtual Machine (EVM)
- Maintained by thousands of connected computers
- Continuous, uninterrupted and immutable
- Contains the one and only canonical state (account balances, smart contracts...)
- Task: compute a new valid state from block to block based on a set of rules:
	Y(S, T)=S' or ERROR
	Y: Function/Rules (Smart Contract)
	S: State; S': new State
	T: Transaction
Example Rule: a bitcoin address cannot spend more Bitcoin than it has previously received

## Architecture
![[Pasted image 20221114105450.png|690]]
This can execute arbitrary machine code -> Smart Contracts

## State
modified Merkle Patricia Trie

## Smart Contract (DApps)
Are decentralized applications defining a set of rules and can be executed after paying some fees on a virtual machine like an EVM.
Written in high level languages like Solidity and is then compiled down into bytecode (intermediary is VM-OpCode)

User (Browser) <-> Frontend/DApp UI (Web Server) **<->** Blockchain/DApp Backend (Smart Contracts)

### Communicating with Smart Contract
Reading from Chain: nothing Required
Writing to Chain: Signature required (signing by Metamask storing Private Key in Browser)

Querying specific Events in Smart Contracts
1. Smart Contract Events
2. [The Graph](https://thegraph.com/) (Off-Chain indexing GraphQL API)

2 Ways to broadcast transaction to the network:
- **Decentralized: Own node as part of network**
- **Centralized: Third-Party Provider**
	E.g: Infura, Alchemy
	They implement a JSON-RPC (stateless, lightweight, transport-agnostic) specification

### Storage
- writing things to chain is expensive -> dont wont to charge user every time -> use of decentralized off-chain storage solutions (IPFS, SWARM)

### Architecture Overview
**Node Provider + Central Web Server**
![[Pasted image 20221116162741.png|500]]

**Node Provider + Decentral Web Server**
![[Pasted image 20221116162948.png|500]]

**Node Provider + Decentral Web Server + Reading from Chain**
![[Pasted image 20221116163457.png|500]]
