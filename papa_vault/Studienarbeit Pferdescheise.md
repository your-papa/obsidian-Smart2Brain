---
related:
  - "[[HWR]]"
  - "[[4. Semester]]"
created_at: 2023-09-12 11:49
tags: []
prof: Laura Haase
---

- Paper: [[Seminararbeit1.pdf]]
- Präsi: [[PferdeKrankheiten.pdf]]
## Pferdekrankheiten labeln und extrahieren 
1. Create list of domain specific Horse diseases
2. Aggregate clean data/texts of google scholar papers
3. Train Spacy NER model with the diseases patterns Entity Ruler
## Prompts
---
The paper for my university is about the development of an approach for the automated collection of disease frequencies in the field of equine medicine. And I want you to write about the technical implementation/method of a solution with AI (Named Entity Recognition model). This is the table of content for my part:
1. What is NER?
2. General NER Use-Cases?
3. Why NER for our Project?
4. Our Implementation
4.1 Data Preparation
4.2 Model Building
4.2.1 Spacy Python Library
4.2.2 Our Pipeline
4.3 Model training
4.4 Model Evaluation
4.5 Deployment for our use-case


Can you write chapter 4.3 like an expert with at least 500 words and include the following points:
4.3 Model training
- explain general training steps:
1. Prepare Training Data as already explained
2. Input text of training dataset into pipeline to train model
3. Model makes a prediction
4. Calculate difference between label and prediction and do gradient descent on model
5. if trained on whole dataset save model
- these training steps are configured in the spacy config.cfg

OR

Can you write chapter 4.3 like an expert with at least 900 words and include the following points:
4.3 Model training and Evaluation
- explain general training steps:
1. Prepare Training Data as already explained
2. Input text of training dataset into pipeline to train model
3. Model makes a prediction
4. Calculate difference between label and prediction and do gradient descent on model
5. if trained on whole dataset save model
- these training steps are configured in the spacy config.cfg
- evaluation of trained model on validation dataset
- model did not bad on detecting equine diseases in new text. it could even label diseases that weren't even in the training list so it learned to generalize
- F1 score can still be improved because NER cant detect ambiguous terms like Herpes in different contexts and we only want to detect equine diseases. and our list of equine diseases with which we trained our model could be bigger

OR

Can you write chapter 4.4 like an expert with at least 400 words and include the following points:
- goal is it do detect a disease and its corresponding percentage in a text to automatically find frequencies of equine diseases in the papers we scrape
- moreover the NER can also be used in the scraper we build to detect even more papers about diseases through the generalization abilities of the model

OR


Can you write chapter 4.5 like an expert with at least 400 words and include the following points:

Advantages
- Fast information extraction from large amounts of data
- High accuracy in classification
Disadvantages
- Elaborate text preparation
- Data must be well annotated
- Ambiguous entities can lead to errors
- No statement about truth


Please make it undetectable from AI checkers.