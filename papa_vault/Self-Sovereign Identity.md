---
related:
- "[[Web]]"
- "[[Digital Identity]]"
created_at:  "29-12-2022 11:35"
tags: Research
alias: SSI
---

# Vision
---
- You own your Identity
- Reduces friction in establishing a relation ship
- No more security breaches where your data is leaked
![[Pasted image 20221124150212.png#invert|600]]

# Technical Implementation
---
## Stack
![[Pasted image 20221229094602.png#invert|600]]

## Dezentral IDentifier (Layer 1)
- Everyone can proof the control over their DID (aka Controller)
- DID can be resolved to a DID Document holding data identifying that controller
- A person can have multiple DID for different relationships and contexts
![[Pasted image 20221230120426.png#invert]]
**DID Document** contains metadata:
1. Set of Public Keys (for verification)
2. Set of auth methods (for authentication)
3. Routing Endpoints where Data is exposed (via Identity Hubs) (for interaction)
4. Timestamp (for audit history)
5. Signature (for integrity)

### Verifiable Data Registry
Can be any Table mapping the DID to the stored DID Documents (could also be centralized)
E.g: DID stored on Blockchain associated with DID Document stored on IPFS for example
Public Blockchains used for public Relationships

### On Bitcoin
![[Pasted image 20221227122954.png#invert|500]]
Updating:
![[Pasted image 20221227123152.png#invert|1000]]

## DIDComm (Layer 2)
**"...is a standard (Secure, Private, Decentralized) way to interact with an identity (not just authenticate one)"** Daniel Hardmann
- Secure communication between peers through DID and their linked PubKeys ([[Puplic Key Infrastructure#Decentralized PKI|DPKI]])
- Requirement: Every party must be able to resolve a DID through a verifiable Data Registry (e.g: public Blockchain)
- The resolving DID Document must contain:
	- DID itself
	- Public Keys for secure connection
	- Service Endpoints specifying where the actual DIDCommunication service sits
	- Authentication methods to provide credentials verifying that the party is who he says he is **(here CA's are replaced)**
 [Great Video on misconceptions](https://www.youtube.com/watch?v=rwvQdRyMeY4)
 - doesn't only provide a way for Cred-Ex, but also answers following questions
   ![[Pasted image 20230102170039.png|700]]
**The point: Ability to talk directly to each other (P2P) instead of only talking about each other (through institutions and VC's: getting the confirmation from someone else)**

## Verifiable Credentials (Layer 3)
**"...is a standard way to say something about an identity"** Daniel Hardmann
- You can always verify who you communicating with
- A standard way to express credentials/licenses in the digital world
- Not stored on-chain, shared through the P2P connections and verified through the PubKeys in the DID-Document of the Holder and Issuer
- Privacy respecting (with [[Zero Knowledge Proofs]])
- Issued by Government for example
![[Pasted image 20221214133759.png#invert|1000]]

## Governance Framework (Layer 4)
![[Pasted image 20230102120753.png#invert]]
Defines how exactly, certain Szenarios/Workflows look like on the human trust level
#TODO: evaluate more on this with help of SSI Book

# Use Cases
---
- **DIDs -> P2P Direct Communication (DIDComm) + Verifiable Credentials -> Better UX, Security, Privacy and Censorship resistance:**
	- Selective information disclosure: Individuals can choose which personal information to disclose when authenticating.
	- Know Your Customer (KYC) processes and onboarding processes in general are drastically improved.
	- A single SSI login and identity can do the job of many (Google, Facebook, etc.).
	- Validated Identity via Verifiable Claims: Attributes of an individual’s identity, such as name, birthplace, address, work history, university certificates, learning records, etc., can be verified by reputable entities such as banks, government, health care provider, and so on.
- and everything that builds on top of it

# Problems
---
- lacking Implementation - early prototyping: [103 experimental specifications](https://w3c.github.io/did-spec-registries/#did-methods)

# Emerging Open Standards
---
![[Pasted image 20221124150303.png#invert|600]]

## Resources
- [[Self-Sovereign Identity_ Decentralized Dig - Alex Preukschat.pdf]]
- [Great Video on SSI](https://www.youtube.com/watch?v=Jcfy9wd5bZI)
- [Why using Blockchain anyways for SSI](https://www.ibm.com/blogs/blockchain/2018/06/self-sovereign-identity-why-blockchain/) TL:DR completely removes trusted Certificate Authorities - public keys can now be looked up by the associated DID (when discovered) on the blockchain -> revolutionized Public Key Infrastructure's
