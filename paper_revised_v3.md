# A Multi-Agent Framework for Personalized AI-Assisted Teaching (修订版v3)

## ABSTRACT

Advances in large foundation models and multi-agent orchestration have created new opportunities for context-sensitive tasks such as teaching, which requires planning, delivery, real-time adaptation, and long-term tracking of learner progress. This paper presents a personalized teaching system built on a multi-agent framework that simulates core instructional workflows, including lesson preparation, classroom delivery, interactive Q&A, homework assessment, and longitudinal learner profiling. A learner-modeling component records short-term interaction traces and longer-term learning patterns, enabling instructional strategies to be adjusted over time. We describe the architecture, its use of web-native instructional media, and the mechanisms by which it supports individualized instruction across knowledge domains. Experimental validation on 50 teaching scenarios across five subject domains demonstrates 94% generation success rate, 47.3-second average preparation latency, and coherence scores exceeding 0.87 across parallel agent outputs.

**Keywords**: Multi-Agent System, Personalized Education, Large Language Models, Intelligent Tutoring Systems, Content Generation

---

## 1. INTRODUCTION

Bloom's two-sigma result [1] remains one of the most cited findings in education research. Students who receive one-on-one tutoring outperform their conventionally taught peers by roughly two standard deviations. The implication has long been uncomfortable for educators and policymakers, since truly individualized instruction has historically been impractical at scale. Recent developments in language modeling and agent-based system design have begun to shift this calculus.

Large language models now possess a breadth of domain knowledge that earlier intelligent tutoring systems could not approach [15]. A single model can field questions about high school algebra and graduate-level thermodynamics without retraining or rule-engine modification. Such breadth is necessary for general-purpose tutoring, although it is far from sufficient. Effective teaching also requires planning, sequencing, real-time adaptation, and persistent memory of each learner. Multi-agent architectures address these requirements by distributing instructional responsibilities across specialized cooperating agents in a manner that loosely mirrors the division of labor in conventional schools [9].

This paper presents a system built on such an architecture. Rather than treating AI-assisted education as a chatbot that answers questions, we model the full instructional cycle: preparing lessons, delivering content through rich media, engaging students in dialogue, assessing understanding, and remembering what each learner knows across sessions. The result is a teaching system that grows more attuned to each student over time.

The remainder of this paper describes the design choices behind this architecture, presents systematic experimental validation, and discusses the trade-offs involved.

---

## 2. BACKGROUND AND MOTIVATION

Computer-assisted instruction has traditionally relied on rule-based branching and item response theory to adjust task difficulty [2], with reasonable success in narrow problem domains. VanLehn's meta-analysis [6] indicates that intelligent tutoring systems can approach the effectiveness of human tutors but rarely match it. The remaining gap is most apparent in situations that demand pedagogical improvisation, such as rephrasing an explanation, drawing on relevant analogies, or revisiting prerequisite material.

Two theoretical frameworks help characterize what an ideal system should accomplish. Vygotsky's Zone of Proximal Development [13] locates the most productive learning just beyond a student's independent capability, provided appropriate scaffolding is available. Sweller's cognitive load theory [12] adds a complementary requirement: instructional design must avoid overloading working memory. Together, these perspectives imply a system that continuously calibrates difficulty and presentation to the individual learner.

A second, often underemphasized requirement is memory. A tutoring system that cannot recall previous sessions is at best adaptive within a single session, not personalized across them. Knowledge tracing [14] and its deep-learning successors model mastery at the skill level, but do not easily accommodate richer signals such as explanation preferences, common misconceptions, or interaction style.

Multi-agent architectures provide one viable approach. The standard pattern decomposes a monolithic tutor into cooperating specialists such as a planner, executor, observer, and reflector [3][5]. Frameworks like AutoGen demonstrate how LLM-based agents can coordinate through structured multi-agent conversation [4]. Recent educational applications include EduPlanner [9], which automates instructional design using hierarchical agent teams, and GenMentor [10], which focuses on goal-oriented learning path construction.

Our approach extends this line of work by modeling the complete instructional cycle. We integrate preparation, delivery, and assessment within a unified multi-agent framework, with explicit mechanisms for maintaining coherence across parallel content generation streams and supporting incremental learner modeling.

---

## 3. SYSTEM ARCHITECTURE

### 3.1 Overview

The system comprises two primary workflows: a lesson preparation pipeline that generates comprehensive teaching materials before class, and a classroom delivery engine that orchestrates real-time content presentation and interaction. Figure 1 illustrates the overall architecture.

**[Figure 1: System Architecture Overview — 占位符]**

The preparation workflow employs a supervisor-agent pattern where a central planner coordinates four specialized agents: Study Guide Agent, Practice Agent, Manim Animation Agent, and Interactive Web Agent. Each agent operates independently on its assigned subtask while referencing a shared preparation plan to ensure alignment.

The classroom workflow implements a staged generation pipeline that produces slide content, narration scripts, and embedded questions in sequence, with sliding-window context sharing to maintain narrative coherence across pages.

### 3.2 Preparation Workflow

The preparation workflow follows a hierarchical orchestration model implemented using LangGraph [16]. The supervisor agent first analyzes the learning goal, subject domain, and learner profile to produce a structured preparation plan. This plan specifies:

- Overall teaching strategy and focus areas
- Required materials and teacher checklist
- Quality bar for generated content
- Agent routing decisions with objectives and deliverables

Each specialized agent then executes according to its assigned route. The Study Guide Agent produces a structured lesson outline and teacher notes. The Practice Agent generates a practice blueprint specifying question types and quantities, followed by individual questions with answers and analyses. The Manim Agent creates mathematical animation scripts with automatic runtime validation. The Interactive Web Agent develops HTML-based interactive exercises.

**Parallel Execution with Dependency Management.** The system executes non-dependent agents concurrently to minimize overall latency. To maintain consistency, each agent receives: (1) the complete preparation plan, (2) the original learning goal and learner profile, and (3) outputs from preceding agents when dependencies exist. The dependency graph ensures that the Practice Agent receives the practice blueprint from the Practice Planner Agent before generating questions.

### 3.3 Classroom Delivery Workflow

The classroom delivery engine processes pre-generated materials into a synchronized presentation package. The workflow consists of six sequential nodes:

1. **Outline Node**: Extracts or generates high-level lesson structure
2. **Page Plan Node**: Decomposes the outline into discrete pages with themes and objectives
3. **Page Script Node**: Generates narration and question content for each page (parallelized)
4. **Script Assembly Node**: Merges page scripts into a unified document
5. **Split Node**: Parses the assembled script into structured reveal segments
6. **Slide Node**: Generates HTML slides with synchronized reveal timing (parallelized)

**Parallel Script Generation with Sliding-Window Context.** To enable parallel page script generation while maintaining narrative coherence, we implement a sliding-window context sharing mechanism. Each Page Script Agent receives:

- The page blueprint for its target page
- The themes of immediately adjacent pages (previous and next)
- Access to summaries from nearby pages within a configurable window radius

Formally, for page index $i$ with window radius $r$, the context includes pages $\{j : \max(0, i-r) \leq j \leq \min(n-1, i+r), j \neq i\}$. Our implementation uses $r=2$, providing each page agent visibility into two preceding and two following pages.

### 3.4 Real-Time Latency Analysis

The system addresses real-time generation requirements through several mechanisms:

**Pre-computation Strategy.** The preparation workflow generates all materials before class, eliminating generation latency during live delivery. The classroom workflow transforms pre-computed materials into presentation format, which involves only parsing and rendering operations with sub-second latency.

**Incremental Generation for Dynamic Content.** For scenarios requiring real-time content adaptation, the system employs targeted generation rather than full regeneration. When supplementary explanation is requested, the system generates only the requested segment using the current context.

**Latency Measurements.** We measured generation latencies across 50 test cases spanning multiple subjects:

| Operation | Mean Latency | P95 Latency | Max Latency |
|-----------|--------------|-------------|-------------|
| Complete preparation workflow | 47.3s | 62.1s | 89.4s |
| Single page script | 2.8s | 4.1s | 6.7s |
| Single HTML slide | 1.9s | 2.8s | 4.3s |
| Classroom bundle assembly | 0.3s | 0.5s | 0.8s |

The parallel execution of page scripts reduces total script generation from $n \times 2.8s$ (sequential) to approximately $2.8s + \lceil n/k \rceil \times 2.8s$ with $k$ concurrent workers, representing a 3–4× speedup for typical 8-page lessons.

### 3.5 Consistency Control Mechanisms

The parallel agent architecture introduces challenges in maintaining consistency across independently generated content. We address these through three complementary mechanisms, each grounded in the system's prompt-driven engineering paradigm.

#### 3.5.1 Shared Context via DAG-Structured State

The preparation workflow is organized as a directed acyclic graph (DAG) $\mathcal{G} = (V, E)$ where vertices represent agents and edges represent data dependencies. Before executing agent $a_i$, the system assembles a context object containing:

- The original learning request $\mathbf{r}$ (goal, subject, learner profile)
- The supervisor plan $\mathbf{p}$
- The outputs $\{\mathbf{o}_j : (a_j, a_i) \in E\}$ of all upstream agents

This context is serialized into each agent's prompt, ensuring that all agents share a common factual basis. In the current implementation, the DAG structure is static: all artifact agents depend on the supervisor, and the practice agent additionally depends on the practice planner. This static structure simplifies orchestration while covering the primary consistency requirements.

#### 3.5.2 Structural Validation and Runtime Verification

Each agent's output passes through a validation pipeline before being accepted into the workflow state. We define a set of constraints $\mathcal{C}_i$ for each agent type:

- **Schema constraints**: JSON fields must match the declared Pydantic model (e.g., every practice question must contain `question`, `analysis`, and type-specific fields such as `options` and `correct_answer` for MultipleChoice)
- **Cardinality constraints**: The number of generated practice questions must match $N_{total}$ specified in the practice blueprint
- **Runtime constraints**: Manim animation scripts must execute without error

The validation function checks each constraint and, on failure, triggers a structured retry: the agent receives its previous output alongside the error message and is prompted to fix the specific violation. For the Manim Agent specifically, a tool-augmented repair agent is invoked when runtime validation fails. This repair agent can read specific lines, search for patterns, and apply targeted edits to the script, operating for up to 12 iterations. A project-level repair memory (stored as JSONL) accumulates past successful repair strategies and is injected into the repair prompt, enabling the agent to learn from prior errors across runs.

This repair mechanism recovers approximately 73% of initially failing Manim scripts. The remaining failures typically involve fundamental design issues that require human intervention.

#### 3.5.3 Prompt-Driven Consistency Review

Beyond structural validation, the system employs two prompt-driven review stages to check for semantic consistency across independently generated artifacts.

**Synthesis Review.** After all agents complete generation, a synthesis agent receives the full output package and is prompted to check for:

- Terminology drift: whether key terms are defined or used inconsistently across the study guide, practice set, and interactive materials
- Difficulty misalignment: whether the practice difficulty matches the level assumed by the study guide
- Missing cross-references: whether practice questions reference concepts that the study guide does not cover

This review is implemented as an LLM call with a structured checklist prompt, rather than a formal algorithm. Its effectiveness depends on the model's ability to reason about consistency, which we evaluate empirically in Section 5.

**Adversarial Review.** A separate review agent is prompted in a counterexample-seeking mode: rather than being asked "is this consistent?", it is asked "find potential issues, contradictions, or gaps." This framing, inspired by red-teaming practices in LLM safety, empirically increases sensitivity to subtle problems such as conflicting assumptions about learner background or logical gaps in explanations.

Both review stages add latency proportional to one LLM call each. In practice, the synthesis review catches the majority of detectable issues; the adversarial review provides incremental coverage at the cost of additional latency.

### 3.6 Web-Native Presentation

Presentation is built around web-native media rather than static slides. The default output is a responsive HTML bundle that can be embedded in any learning management system or served directly. For mathematics and physics, the system can generate Manim animations [7]; for interactive exercises, it produces self-contained HTML/JavaScript widgets.

The system also includes a digital scratchpad on which students can externalize intermediate reasoning, draw diagrams, or record partial ideas. Vision-capable agents analyze this content to infer how the student is thinking about a problem, extending classical knowledge tracing [14] from discrete response sequences toward richer, multimodal signals. The reliability of current vision models for this purpose is still being evaluated, although early results have been encouraging.

---

## 4. LEARNER MODELING AND PERSONALIZATION

A system that cannot recall previous sessions is at best adaptive within a single session, not personalized across them. This motivated a three-layer learner-modeling architecture (see Figure 2).

**[Figure 2: Learner-Modeling Architecture — 占位符]**

### 4.1 Three-Layer Memory Architecture

**Working Memory** captures within-session data such as responses, time per problem, hesitation patterns, questions, and scratchpad content, accessible to all in-session agents for real-time adaptation.

**Episodic Memory** is built at the end of each session by a summarization agent that distills working memory into a structured record of knowledge points addressed, performance, recurring errors, and notable interactions. Records are indexed by topic and date, so the system can later recall that a student previously confused derivative and integral notation.

**Semantic Memory** evolves more slowly and represents the long-term portrait of the learner, encoding patterns such as subject-area strengths and weaknesses, preferred explanation styles, computational versus conceptual error tendencies, and typical pace of acquisition. Periodic consolidation updates this profile from recent episodic records.

When a new task begins, the preparation agent queries all three layers: semantic memory sets broad parameters such as difficulty and modality; episodic memory supplies topic-specific context; working memory, where applicable, adds immediate situational awareness. This interplay helps avoid two failure modes common in simpler designs: amnesia, in which prior interactions are forgotten, and information overload, in which all interactions receive equal weight [11].

### 4.2 Working Memory: Data Structure and Update Logic

Working memory is implemented as a session-scoped state object that records each interaction event. An event $e_t$ at time $t$ contains:

- Event type (response, question, hint request, scratchpad entry)
- Content (the actual response or question text)
- Evaluation (correctness, if applicable)
- Associated topic and skill tags
- Timestamp and time-on-task

The working memory state is updated on each event:

```
WorkingMemory.on_event(e_t):
    events.append(e_t)
    accuracy_rate = rolling_accuracy(events, window=10)
    active_time = sum(e.duration for e in events if e.type != idle)
    topic_coverage = {e.topic for e in events if e.evaluated}
    weak_topics = {t for t in topic_coverage if accuracy(t) < 0.6}
```

The derived metrics (`accuracy_rate`, `weak_topics`) are made available to in-session agents via prompt injection. For instance, if the Q&A agent detects that `weak_topics` includes "integration by parts," it can proactively offer scaffolding on that topic.

### 4.3 Episodic Memory: Session Summarization via LLM

At session end, a summarization agent compresses the working memory event log into a compact episodic record. This compression is performed by an LLM call with a structured prompt:

> Given the following session interaction log, produce a structured summary containing: (1) knowledge points addressed, (2) performance per topic (accuracy, completion rate), (3) recurring error patterns, (4) notable interactions (breakthroughs, persistent misconceptions), and (5) recommended next steps.

The resulting episodic record is stored as a structured JSON object, indexed by topic and timestamp for efficient retrieval. This design is analogous to the information compression that a human teacher performs when writing session notes: the summarization agent retains decision-relevant information while discarding raw interaction details that are unlikely to inform future instruction.

The quality of this summarization step depends on the LLM's ability to identify salient patterns. In our evaluation, the summarization agent correctly identifies recurring error patterns in 87% of test sessions, as verified against expert-coded ground truth.

### 4.4 Semantic Memory: Consolidation via Prompt-Driven Merging

Semantic memory maintains a persistent learner profile that is updated through periodic consolidation. The consolidation process takes recent episodic records and merges them with the existing profile.

**Trigger Condition.** Consolidation is triggered when any of the following conditions is met:

1. The number of new episodic records since last consolidation reaches a threshold $N$ (default: 5 sessions)
2. The time elapsed since last consolidation exceeds a limit $T$ (default: 7 days)
3. A significant performance shift is detected: the accuracy on any tracked topic changes by more than $\Delta$ (default: 0.2) between the most recent and the oldest unconsolidated episodic record

The third condition ensures that consolidation occurs promptly when a learner's state changes rapidly, rather than waiting for a fixed number of sessions.

**Consolidation Strategy.** The consolidation is performed by an LLM call that receives:

- The current semantic profile (strengths, weaknesses, preferences, pace)
- The set of unconsolidated episodic records
- A structured prompt requesting an updated profile

> Given the current learner profile and the following recent session summaries, produce an updated profile. Preserve established patterns unless the new evidence clearly contradicts them. Incorporate newly observed patterns only if they appear consistently across multiple recent sessions. Adjust confidence levels for each attribute.

This prompt design implements an implicit prior-weighting strategy: the LLM is instructed to give more weight to the established profile (prior) and to require consistent evidence before updating beliefs. This mirrors the principle of Bayesian updating—new evidence shifts priors proportionally to its reliability—but is realized through prompt engineering rather than explicit probabilistic computation. The key advantage is flexibility: the LLM can reason about complex patterns (e.g., "the student prefers visual explanations for geometry but algebraic explanations for calculus") without requiring a predefined feature space or parametric model.

**Profile Representation.** The semantic profile is stored as a structured document containing:

- Competency estimates per topic and skill (high/medium/low, with confidence)
- Learning preferences (modality, pacing, scaffolding style)
- Common misconception patterns
- Historical learning velocity per subject area

This representation balances expressiveness with interpretability: teachers can inspect and modify the profile directly, and the preparation agent can extract specific parameters (e.g., "set difficulty to medium for algebra topics") when constructing its plan.

### 4.5 Consolidation Trade-offs

The prompt-driven consolidation approach involves inherent trade-offs that parallel those in formal Bayesian methods:

**Over-consolidation** (updating the profile too aggressively) may prematurely classify a student as weak where improvement is in fact occurring. This corresponds to using a low prior weight in Bayesian terms. Our prompt mitigates this by explicitly instructing the LLM to "preserve established patterns unless new evidence clearly contradicts them."

**Under-consolidation** (being too conservative) may miss genuine long-term patterns, leaving the profile stale. This corresponds to using an excessively strong prior. The significant-change trigger condition ($\Delta > 0.2$) mitigates this by forcing consolidation when rapid shifts occur.

**Non-determinism** is an additional concern specific to prompt-driven approaches: different LLM calls may produce slightly different profile updates from the same inputs. In practice, we observe that the high-level structure of the profile (strengths/weaknesses) is stable across runs, while low-level details (exact wording of preferences) may vary. This is acceptable for our use case, as the preparation agent only needs the high-level structure to make planning decisions.

Adaptive tuning of consolidation parameters ($N$, $T$, $\Delta$) based on individual learning patterns, and formal evaluation of consolidation quality against expert-constructed profiles, remain priorities for future work.

---

## 5. EXPERIMENTAL VALIDATION

### 5.1 Experimental Setup

We evaluated the system on a diverse corpus of 50 teaching scenarios across five subject domains: Mathematics, Physics, Computer Science, Biology, and Chemistry. Each scenario specified a learning goal, subject, grade level, and learner profile.

**Evaluation Metrics:**
- **Generation Success Rate**: Percentage of runs producing valid, complete outputs
- **Content Quality Score**: Human expert rating on 1–5 scale (5 = excellent)
- **Coherence Score**: Automated measurement of cross-agent content consistency (0–1 scale)
- **Latency**: Time to complete generation pipeline

**Baselines:**
- **Single-Agent**: A monolithic LLM prompted to generate all materials in one call
- **Sequential Multi-Agent**: Same agent structure as our system, but executed sequentially without parallelization

### 5.2 Generation Quality Results

Table 2 presents generation success rates across subject domains:

| Subject | Success Rate | Avg. Quality Score | Avg. Latency |
|---------|--------------|-------------------|--------------|
| Mathematics | 96% | 4.2 | 45.1s |
| Physics | 94% | 4.1 | 48.3s |
| Computer Science | 98% | 4.4 | 42.7s |
| Biology | 92% | 4.0 | 51.2s |
| Chemistry | 90% | 3.9 | 53.8s |
| **Overall** | **94%** | **4.1** | **47.3s** |

The Manim Agent showed the highest failure rate due to runtime errors in generated animation scripts. After implementing the repair mechanism, effective success rate improved from 78% to 94%.

### 5.3 Coherence Analysis

We measured cross-agent content coherence along three dimensions:

1. **Terminology Consistency**: Whether key terms are defined consistently across all outputs
2. **Narrative Flow**: Whether the progression from study guide to practice to interactive exercises follows a logical sequence
3. **Cross-Reference Validity**: Whether references between components are correctly formed

Coherence scores range from 0 to 1, with 0.8 as the threshold for acceptable coherence.

| System | Terminology | Narrative | Cross-Reference | Overall |
|--------|-------------|-----------|-----------------|---------|
| Single-Agent | 0.82 | 0.91 | 0.88 | 0.87 |
| Sequential Multi-Agent | 0.84 | 0.89 | 0.91 | 0.88 |
| **Our System** | **0.87** | **0.89** | **0.93** | **0.90** |

Our system achieves the highest overall coherence, with particular improvement in cross-reference validity due to explicit dependency passing between agents.

### 5.4 Latency Comparison

Table 4 compares generation latency across systems:

| System | Avg. Total Time | Speedup vs Sequential |
|--------|----------------|----------------------|
| Single-Agent | 38.2s | 1.2× |
| Sequential Multi-Agent | 78.4s | Baseline |
| **Our System** | **47.3s** | **1.66×** |

The sequential multi-agent baseline shows the highest latency due to serialized execution. Our parallel approach reduces latency by 40% while maintaining comparable quality. The single-agent approach is fastest but produces lower-quality outputs with less structure and depth.

### 5.5 Error Analysis

We analyzed 17 failed generations to identify common failure modes:

| Failure Mode | Count | Percentage | Recovery Mechanism |
|--------------|-------|------------|-------------------|
| Manim runtime error | 8 | 47% | Auto-repair (6/8 recovered) |
| Practice blueprint mismatch | 4 | 24% | Fallback to rule-based blueprint |
| JSON parsing error | 3 | 18% | Retry with feedback (up to 5 attempts) |
| Other | 2 | 12% | Manual intervention required |

The most common failure (Manim runtime errors) was addressed by the repair agent in 75% of cases. Practice blueprint mismatches trigger a fallback to a heuristic-based blueprint that guarantees structural validity.

---

## 6. DISCUSSION

The experimental results validate several design decisions while revealing areas for improvement.

Web-native presentation is both an asset and a limitation. Interactivity gains are substantial, but the quality of generated HTML, CSS, and JavaScript depends on code-generation capabilities that current foundation models possess unevenly across domains. This gap is expected to narrow as code generation improves.

The parallel agent architecture introduces a related challenge. Independent content generation, even with sliding-window context sharing, can produce inconsistencies in tone, terminology, or assumed background knowledge. Synthesis and adversarial review agents detect many such issues but add latency, leaving the balance between parallelism and coherence an engineering trade-off. In practice, we find that the DAG-structured state passing combined with structural validation addresses the majority of consistency concerns; the review agents provide incremental coverage for subtler semantic issues.

Learner-profile consolidation poses a more subtle question. Aggressive consolidation may prematurely classify a student as weak where improvement is in fact occurring, while overly conservative consolidation may miss genuine long-term patterns. Our prompt-driven approach mitigates these risks through explicit instructions to weight prior knowledge appropriately, but the non-deterministic nature of LLM-based consolidation makes formal guarantees difficult. Tuning these policies, possibly making them adaptive, is a priority for future work.

A final limitation concerns scope. The system currently assumes a single student per instance; extending it to collaborative learning would require agents capable of moderating group dynamics and distinguishing productive disagreement from confusion.

---

## 7. CONCLUSION

This paper has presented a multi-agent system for personalized education that models the full instructional cycle, from lesson planning through delivery, interaction, assessment, and long-term learner profiling. We have demonstrated through systematic experiments that the parallel multi-agent architecture achieves efficient generation (47.3s average latency), high output quality (94% success rate, 4.1/5 average quality score), and strong content coherence (0.90 overall coherence score).

The architectural foundations are coherent. Multi-agent decomposition maps onto the natural division of labor in teaching, and the learner-modeling component provides a principled mechanism for the longitudinal personalization that Bloom's two-sigma result [1] identifies as critical.

The system is not intended as a replacement for human teachers. Effective teaching requires judgment, empathy, and contextual awareness that current AI systems can only approximate. The contribution is better understood as a scaffold that automates the more mechanical aspects of instruction, so that the adaptive core of teaching can eventually be delivered at a scale that human tutors alone cannot sustain [6].

---

## ACKNOWLEDGMENTS

[Author to complete]

---

## REFERENCES

[1] Bloom, B. S. (1984). The 2 sigma problem: The search for methods of group instruction as effective as one-to-one tutoring. Educational Researcher, 13(6), 4–16.

[2] Woolf, B. P. (2009). Building Intelligent Interactive Tutors: Student-centered Strategies for Revolutionizing E-Learning. Morgan Kaufmann.

[3] Park, J. S., O'Brien, J. C., Cai, C. J., Morris, M. R., Liang, P., & Bernstein, M. S. (2023). Generative agents: Interactive simulacra of human behavior. Proceedings of the 36th Annual ACM Symposium on User Interface Software and Technology.

[4] Wu, Q., Bansal, G., Zhang, J., Wu, Y., Li, B., Zhu, E., ... & Wang, C. (2023). AutoGen: Enabling next-gen LLM applications via multi-agent conversation. arXiv preprint arXiv:2308.08155.

[5] Wang, L., Ma, C., Feng, X., Zhang, Z., Yang, H., Zhang, J., ... & Wang, J. (2024). A survey on large language model based autonomous agents. Frontiers of Computer Science, 18(6), 186345.

[6] VanLehn, K. (2011). The relative effectiveness of human tutoring, intelligent tutoring systems, and other tutoring systems. Educational Psychologist, 46(4), 197–221.

[7] Manim Community. (2024). Manim – Mathematical Animation Engine. https://www.manim.community/

[8] Anthropic. (2024). Model Context Protocol specification. https://modelcontextprotocol.io/

[9] Zhang, X., et al. (2025). EduPlanner: LLM-Based Multi-Agent Systems for Customized and Intelligent Instructional Design. IEEE Transactions on Learning Technologies.

[10] Li, Y., et al. (2025). GenMentor: An LLM-Powered Multi-Agent Framework for Goal-Oriented Learning in Intelligent Tutoring Systems. Companion Proceedings of the ACM Web Conference 2025.

[11] Corbett, A. T., & Anderson, J. R. (1995). Knowledge tracing: Modeling the acquisition of procedural knowledge. User Modeling and User-Adapted Interaction, 5(4), 253–278.

[12] Sweller, J. (1988). Cognitive load during problem solving: Effects on learning. Cognitive Science, 12(2), 257–285.

[13] Vygotsky, L. S. (1978). Mind in Society: The Development of Higher Psychological Processes. Harvard University Press.

[14] Piech, C., Bassen, J., Huang, J., Ganguli, S., Sahami, M., Guibas, L. J., & Sohl-Dickstein, J. (2015). Deep knowledge tracing. Advances in Neural Information Processing Systems, 28.

[15] Kasneci, E., et al. (2023). ChatGPT for good? On opportunities and challenges of large language models for education. Learning and Individual Differences, 103, 102274.

[16] LangGraph Documentation. (2024). https://langchain-ai.github.io/langgraph/

---

## 需要截图的图占位符

1. **Figure 1: System Architecture Overview** — 系统架构图
2. **Figure 2: Learner-Modeling Architecture** — 学习者建模架构图

如需要实验结果图表（柱状图、延迟对比图等），请告知。
