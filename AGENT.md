# AGENT.md: Physics Tetris Environment Specification

## 1. Game Overview

Physics Tetris is a puzzle/strategy game that combines traditional falling-block mechanics with a 2D/3D rigid-body physics engine.

During the falling phase, blocks are controlled kinematically by the player (or an AI Agent). Once a block makes contact with another object, it immediately transitions into a physically simulated rigid body affected by gravity, collisions, friction, and torque.

The core objective of the game is to build the highest and most stable structure possible while managing a limited number of lives.

---

# 2. Core Rules and Environment Settings

## 2.1 Field and Coordinate System

### Platform

- The platform is located at the bottom center of the scene.
- Its width is limited to **10 times the side length of a basic block (10 Units)**.
- The platform surface has a high friction coefficient to prevent bottom-layer blocks from sliding easily.

### Boundaries

- There are no horizontal walls restricting movement.
- If a block moves beyond the vertical range of the platform and loses balance, it will fall freely into the abyss.

---

## 2.2 State Transition Logic

The game uses a two-state system:

### Kinematic State (Falling State)

A newly generated block is controlled according to classic Tetris rules.

The player or Agent can perform:

- Move left
- Move right
- Rotate (90-degree increments)
- Soft drop
- Hard drop

During this state:

- The block is not affected by physics engine gravity.
- External collision forces are ignored.
- The block follows deterministic player/Agent control.

---

### Dynamic State (Physics State)

When the block collider makes contact with:

- The platform, or
- Any previously placed block,

the block immediately loses player control and transitions into a rigid-body simulation state.

The block is then affected by:

- Gravity
- Collision forces
- Friction
- Torque
- Rigid-body dynamics

---

### Center of Mass

Each block calculates its true center of mass based on its shape:

- I
- J
- L
- O
- S
- T
- Z

---

### Rigid Body Dynamics

If the overall center of mass of the block structure:

- Falls outside the horizontal support region of the platform, or
- Experiences an unstable torque,

the structure may:

- Rotate
- Tilt
- Slide
- Collapse

according to physical laws.

---

## 2.3 Lifecycle and Termination Conditions

### Lives

The player starts with:

```

Lives = 3

```

---

### Drop Detection

A block is considered "dropped" when:

```

Y < 0

```

meaning that a placed block falls below the bottom boundary of the screen.

Each dropped block:

```

Lives -= 1

```

---

### Game Over

When:

```

Lives == 0

```

the game ends.

The system freezes the current physical world state and performs final score calculation.

---

# 3. Scoring System

## Design Principle

Survival time is relatively easy to achieve, while constructing tall stable structures is extremely difficult.

Therefore:

- Time score increases linearly with low weight.
- Height score grows polynomially/exponentially to encourage risky but mechanically challenging constructions.

---

## 3.1 Variable Definitions

Let:

- **T**: Total survival time (seconds)

- **H**: Maximum stable stack height, measured in basic block units.

  "Stable" means the highest Y-coordinate measured when the rigid-body system enters the sleeping state.

- **N**: Total number of successfully placed blocks on the platform.

---

# 3.2 Score Formula

The total score is:

\[
S_{total}=S_{time}+S_{place}+S_{height}
\]

It consists of three components:

1. Survival Score
2. Placement Score
3. Peak Height Score

---

## ① Survival Score

Provides basic reward for staying alive.

The contribution is intentionally small to prevent passive survival strategies.

\[
S_{time}=\alpha \times T
\]

Recommended parameter:

```

α = 1

```

Meaning:

```

1 point per second survived

```

---

## ② Placement Score (Height-Based Reward)

Whenever a block is successfully placed and enters a stable sleeping state without falling, the player receives an immediate reward.

The reward increases with the current stack height.

Higher placement gives higher reward.

\[
S_{place}=\sum_{i=1}^{N}(\beta \times h_i)
\]

Recommended parameter:

```

β = 5

```

where:

- \(h_i\) is the center-of-mass height of the i-th successfully stabilized block.

---

## ③ Peak Height Score (Main Scoring Component)

The most important scoring factor.

The final score is determined by the highest stable height ever achieved.

A quadratic curve is used:

\[
S_{height}=\gamma \times H^2
\]

Recommended parameter:

```

γ = 10

```

Examples:

Height:

```

H = 5

```

Additional score:

```

10 × 5² = 250

```

Height:

```

H = 15

```

Additional score:

```

10 × 15² = 2250

```

This creates a significant incentive for high-risk vertical construction.

---

# 3.3 Penalty Mechanism

When a block falls:

- The player loses one life.
- The score contribution previously provided by this block is removed.
- The physical structure experiences natural disturbances and vibrations caused by the collapse.

---

# 4. Agent Interaction Interface

For reinforcement learning training, the game is modeled as a Markov Decision Process (MDP).

---

# 4.1 Action Space

Discrete action space:

```

Size = 5

```

Available actions:

| Action | Description |
|---|---|
| MOVE_LEFT | Move block left by 1 Unit |
| MOVE_RIGHT | Move block right by 1 Unit |
| ROTATE_CW | Rotate clockwise by 90 degrees |
| SOFT_DROP | Accelerate downward movement |
| HARD_DROP | Instantly move to the predicted collision point and activate rigid-body physics |

---

# 4.2 Observation Space

## Current Piece

Contains:

- Shape ID (one-hot encoded)
- X coordinate
- Y coordinate
- Rotation angle

---

## Next Piece

Contains:

- Shape ID

---

## World State

Because the environment contains irregular stacking and tilted rigid bodies, a traditional 2D grid representation is insufficient.

Recommended representations:

---

## Option A: Raycast / Heightmap

Cast multiple rays downward from the top.

Return:

- Collision height
- Surface normal vector

Used to estimate:

- Terrain shape
- Slope
- Stability

---

## Option B: Image Representation

Render the current stack region as:

- A 2D silhouette mask
- A pixel matrix

Use the rendered image as input for a CNN-based agent.

---

## Option C: Graph / Vector Representation

Represent each placed block using:

\[
(x,y,\theta)
\]

where:

- \(x,y\): center-of-mass coordinates
- \(\theta\): rotation angle

The entire structure becomes a list of rigid-body states.

---

# 4.3 Reward Function for Reinforcement Learning

The training reward should align with the final scoring system.

---

## Step Reward

For each simulation step:

```

+0.01

```

Purpose:

Encourage survival.

---

## Placement Reward

When a block is successfully placed and remains stable:

\[
+0.5 \times h_{current}
\]

Purpose:

Encourage building at higher locations.

---

## Drop Penalty

When a block falls:

```

-5.0

```

Purpose:

Discourage unstable structures.

---

## Game Over Penalty

When the game ends:

```

-10.0

```

Purpose:

Discourage premature failure.
```
