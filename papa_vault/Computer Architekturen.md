---
related:
- "[[Struktur von Rechenanlagen]]"
- "[[Embedded Systems]]"
created_at: "30-10-2022 13:14"
---


# Von Neumann
---
Used in laptops, personal computers and workstations
![[Pasted image 20221030131750.png|300]]

## Advantages
- Less expesnive/complex
- Efficient
## Disadvantages
- 2 Clock cycles per instruction
- Neumann Bottleneck
- Greater chance of data loss

## Problem - Von Neumann Bottleneck
One Bus for everything. Results in the CPU being idle as it's faster than a data bus. Needs to wait for data to arrive.
## Solutions
- Caching
- Prefetching
- Multithreading
- New types of [[RAM#DDR]]

# Harvard
---
Used in signal processing and micro-controllers
![[Pasted image 20221030131812.png|300]]

## Advantages
- 1 Clock cycles per instruction
- Less chance of data corruption
- High performance
- Greater memory bandwidth
## Disadvantages
- Complex
- Expensive

## Modified Harvard Architecture
- Split-cache architecture
- Instruction-memory-as-data architecture
- Data-memory-as-instruction architecture

