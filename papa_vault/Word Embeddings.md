---
related:
- "[[Artificial Intelligence]]"
- "[[Datenanalyse]]"
created_at:  "14-03-2023 17:04"
alias: word vectors
---

# Why?
---
**How to give words a meaningful numerical representation so that computer can work with them?**
One hot encoding

**And how to store information about similarities between words in this representation?**
What: Through vectors which embed the relation to all other words in the vocabulary

# How? Generation of Word Vectors
---
Input: One hot encoded Words (5000 Words -> 5000 Inputs/Dimension)
-> Neural Network with less Inputs/Neurons (eg. 100)
-> Output: Softmax Probability distribution over 5000 Words

in Training:
Gradient descent over the difference between Output and the actual next word in a given text/context

after training:
Middle Layer (100 Neurons) capture generalized context of the given training data
-> able to predict next word pretty well and comparing similarity/difference of words through subtracting the probability distribution (Word Vector) of two words -> the smaller the difference the more similar the words

Those 5000 dimensional vectors could then be shown in 2 or 3 dimensional word clusters by using [[Datenanalyse#Hauptkomponenten Analyse (PCA)|PCA]]

![(62) Word Embedding and Word2Vec, Clearly Explained!!! - YouTube](https://www.youtube.com/watch?v=viZrOnJclY0&ab_channel=StatQuestwithJoshStarmer)
