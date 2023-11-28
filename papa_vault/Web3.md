---
related:
- "[[Web]]"
- "[[Future 2040]]"
created_at:  "27-10-2022 19:58"
tags: Research
---

# Vision
---
**Trust less** digital platform where sensitive and non-sensitive data can be exchanged.
Give ownership back to the users/creators over their data by creating a **decentralized** platform (through [[Layer 2#DApps|DApps]]) which is governed by these users.

Characteristics:
-> Trust less
-> Borderless
-> Censorship resistant
-> Nearly instant
-> Portable

**READ-WRITE-OWN**

# Dimensions
---
- **security**
- **decentralization/trust**
- **scalability (speed)**
- privacy/transparency
- cost
- Community
- Sustainability
- storage (block size)

# Technical Implementation
---
## [[Layer 0]]
## [[Layer 1]]
## [[Layer 2]]

# Fly Wheel
---
![[Invert Colors.png]]

# Use Case Stack
---
##  [[Layer 2]] (Use Case Layer)
- [[Metaverse]]
- Games
- Content/Social
- DAOs
- [[Non-Fungable-Token|NFT]]

- [[Decentralized Finance|DeFi]]: Payment
- [[Mixer]]: Improves Privacy

## [[Layer 1]]
- [[Oracle]]: Bringing Real World Data into Chain
- [[Crypto Bridge]]: interoperability

# Existing Platforms
---
![[Pasted image 20221115160059.png]]

#TODO: DTPS would be better to measure (DTPS is the product of Transactions per Second (TPS) multiplied by the “Decentralization Quotient” (DQ).)

## "[[Layer 0]]"
```dataview
table without id file.link as Chain, tps as "TPS", finality as Finality, safety-threshold as "Safety Threshold", consensus as Consensus from [[Layer 0]] where tps != null sort tps desc
```

## [[Layer 1]]
```dataview
table without id file.link as Chain, tps as "TPS", finality as Finality, nodes as "Nodes", storage-cost as "$ per GB", safety-threshold as "Safety Threshold", consensus as Consensus from [[Layer 1]] where tps != null sort tps desc
```
Oracles: [[Chainlink]]
Bridges: -
Other [Comparisons](https://blockchain-comparison.com/blockchain-protocols/)

## [[Layer 2]]
```dataview
table without id file.link as "Token", use-case as "Use Case" from [[Layer 2]] where use-case != null and use-case != "Scaling Solution"
```

```dataview
table without id file.link as "Scaling Solution", tps as "TPS", technology as "Technology" from [[Layer 2]] where use-case = "Scaling Solution"
```

# Current Problems
---
## Centralization
- OpenSea, Etherscan, MetaMask rely on Infura, Alchemy
- Web3 Protocols slow to evolve -> rather use centralized infrastructure where we know how it is done
- Some tokens are mostly owned by major Players

## Scalability
- Scalability Trilemma - Chains are made faster and cheaper by centralizing them and compromising security
- Some [[Layer 2#Scaling Solutions|Scaling Solutions]] still too slow? No

## Poor UI/UX
- not building upon standards, no interoperability

# Resources
---
## Learning
- [SAP Sharepoint](https://sap.sharepoint.com/sites/204608/SitePages/HXM(1).aspx)
- [Crypto Startup School](https://a16z.com/crypto-startup-school/ "https://a16z.com/crypto-startup-school/"): Videos on Basics & more
- [Good non-technical Web3 explanation](https://www.ted.com/talks/shermin_voshmgir_web3_blockchain_cryptocurrency_a_threat_or_an_opportunity)
- [Coinbase Simple Web3 Guide](https://www.coinbase.com/blog/a-simple-guide-to-the-web3-stack "https://www.coinbase.com/blog/a-simple-guide-to-the-web3-stack")
- [Building Web 3 Block by Block - By SAP](https://sapphireventures.com/blog/building-web3-block-by-block/)
- [Web3 at SAP](https://radar.tools.sap/en/itonics_technology_tr3/146/details#sort_type=ds_created&sort_order=desc)
- [Making DApp](https://www.preethikasireddy.com/post/the-architecture-of-a-web-3-0-application)
- [Baseline Protocol](https://docs.baseline-protocol.org/ "https://docs.baseline-protocol.org/"): standard for state synchronization across different parties
- ([Crypto Made Simple - WhiteboardCrypto](https://whiteboardcrypto.com/))
- ([What Problem Blockchains Actually Solve](https://solutionspace.blog/2021/12/21/what-problem-blockchains-actually-solve/))

## Tools
- [Coin Market Caps](https://coinmarketcap.com/)
- [Tokenterminal](https://tokenterminal.com/terminal/metrics/revenue?gclid=CjwKCAiAjs2bBhACEiwALTBWZQdrD_McRgCLEruGGPzX9Tbhv0XQlAvW3KytFFbZcPs-0ogFVQI1wRoCsjAQAvD_BwE "https://tokenterminal.com/terminal/metrics/revenue?gclid=CjwKCAiAjs2bBhACEiwALTBWZQdrD_McRgCLEruGGPzX9Tbhv0XQlAvW3KytFFbZcPs-0ogFVQI1wRoCsjAQAvD_BwE"): Crypto Stats
- [Bitcoin Fees](https://bitcoinfees.earn.com/)
- [Everything Bitcoin](https://mempool.space/)
- [Great Bitcoin website](https://learnmeabitcoin.com/)
- [Eth Layer 2 TVL, Risk assessment](https://l2beat.com/scaling/tvl)
- [Eth Layer 2 Fees](https://l2fees.info/)
- [Blockchain Transaction Visualizer - TxStreet.com](https://txstreet.com/d/home)
- [ETH.BUILD](https://sandbox.eth.build/)
Analytics:
- [Bitcoin](https://www.lookintobitcoin.com/charts/)
- [Ethereun](https://app.intotheblock.com/coin/ETH)
- [Glasnode](https://glassnode.com/)
- Tool Landscape:
![[Pasted image 20221115160439.png]]

## Platforms
- [JP Morgan Onyx](https://www.jpmorgan.com/onyx/index "https://www.jpmorgan.com/onyx/index")
	- bank-led blockchain platform 
	- Liink: exchange of payment related information
	- Coin System: payment platform
- [mesh.xyz](https://www.mesh.xyz/ "https://www.mesh.xyz/")
	- investment, incubation, research & development, acceleration
	- huge portfolio in all areas
- [90 Ethereum Apps](https://consensys.net/blog/news/90-ethereum-apps-you-can-use-right-now/ "https://consensys.net/blog/news/90-ethereum-apps-you-can-use-right-now/")
- [EY Plattform](https://www.ey.com/en_gl/blockchain-platforms "https://www.ey.com/en_gl/blockchain-platforms"): enterprises can use standardized apps and tokens on public chain protected by privacy technology (uses baseline protocol)