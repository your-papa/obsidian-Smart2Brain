---
related:
- "[[Web3]]"
- "[[Layer 1]]"
created_at:  "16-11-2022 11:19"
tps: 7
finality: 59m
consensus: PoW
safety-threshold: 51%
nodes: 15,000
---
related: [[Layer 1]]

# General
---
- ₿itcoin was invented by Satoshi Nakamoto (Pseudonym) in 2009
- It is the oldest and most secure Blockchain in existence
- Highest Market Cap of all Coins
- Completely decentralized and not "owned" by major players
- Limited Supply: capped at 21,000,000 Bitcoin
	- until then Inflation schedule (mining reward halved every year)
	- afterwards: deflationary

# Dimensions
---
## Scalability
7 Tps -> [[Bitcoin Lightning]]

## Security & Decentralization
**Event in 2017**
https://dcgco.medium.com/bitcoin-scaling-agreement-at-consensus-2017-133521fe9a77
Big Companies tried to increase Block Size of Bitcoin
They used new updated Bitcoin
But these Blocks were rejected of the normal users because their hardware isnt good enough to hold big blocks -> centralization
-> 2 separate Networks:
- Bitcoin: with old update run by normal users
- Bitcoin Cash: updated Block Size run by Companies

# Bitcoin Script
---
Part of a Transaction (Locking Script & Unlocking Script)
Non Standard scripts are not mined by nodes
NOT TURING COMPLETE
Does not allow for logical loops -> DoS resistent
[Great Video on all Scripts](https://www.youtube.com/watch?v=6Fa04MnURhw)

## Pay-to-Public-Key-Hash
P2PKH most common normal transaction

## Multi-Signature Scripts
## Time Locked Scripts
## Pay-to-Script-Hash
P2SH -> makes Multi Signature scripts smaller

## Coming Soon: Pay-to-Taproot
Unite the functionality of P2PKH and P2SH

# Existing Scripts
---
## Discreet Log Contract
Private Bets between to people on an event resolved by oracle.
After the event happens, the oracle publishes a commitment that the winning party can use to claim their funds.

### Technical Explanation - #TODO
Contract not bigger than a normal Multisig transaction on-chain
Originally Required: Bitcoin Taproot upgrade -> Introducing the Schnorr signature
Later Required: Signature Adaptors that are compatible with existing signature scheme
1. People lock funds into multisig address
![[Bitcoin 2022-12-14 23.03.08.excalidraw|700]]

### Use Case
- Sports Betting
- Trading

### Problems
- Oracle Problem

# Resources
---
- Whitepaper: [[bitcoin.pdf]]
- [Mastering Bitcoin](https://masteringbitcoin.neocities.org/)
- [Bitcoin ist Zeit](https://www.blocktrainer.de/uebersetzungen/bitcoin-ist-zeit/)
- [Great technical videos](https://www.youtube.com/@learnmeabitcoin/videos)
- [Great Bitcoin website](https://learnmeabitcoin.com/)
- [Bitcoin Smart Contracts](https://river.com/learn/what-are-bitcoin-smart-contracts/)
- [Reddit Entry Page](https://www.reddit.com/r/Bitcoin/comments/omwu51/bitcoin_newcomers_faq_please_read/)
- [Every Argument why Bitcoin will not fail](https://safehodl.github.io/failure/#is-a-ponzi-or)