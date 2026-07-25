# AGENT.md: Physics Tetris Environment Specification

## 1. Game Overview

Physics Tetris is a puzzle/strategy game that combines traditional block-control mechanics with a 2D/3D rigid-body physics engine.

A newly spawned block appears at the highest point of the screen and does NOT fall automatically. The player (or an AI Agent) moves and rotates it freely at the top of the screen. When the player presses the drop key (Space), the block immediately becomes a physically simulated rigid body and falls under real physics — affected by gravity, collisions, friction, and torque. During the fall the block cannot be controlled.

The core objective of the game is to build the highest and most stable structure possible while managing a limited number of lives.

---

# 2. Core Rules and Environment Settings

## 2.1 Field and Coordinate System

### Platform

- The platform is small and located at the center of the screen (it occupies only a small portion of the screen area, with open space on all sides).
- Its width is limited to **10 times the side length of a basic block (10 Units)**.
- The platform surface has a high friction coefficient to prevent bottom-layer blocks from sliding easily.

### Boundaries

- There are no horizontal walls restricting movement.
- A **ground** (floor) exists below the platform, covering the area **outside** the platform's footprint.
- If a block loses balance and falls off the platform, it falls onto this surrounding ground.
- Only when a block lands on (comes to rest on) the ground **outside** the platform is it treated as a dropped block (see §2.3).

---

## 2.2 State Transition Logic

The game uses a two-state system:

### Hover State (Control State)

A newly generated block spawns at the highest point of the screen and **does not fall automatically**. It hovers in place under player/Agent control.

The player or Agent can perform:

- Move left
- Move right
- Rotate clockwise (Up key)
- Rotate counterclockwise (Down key)
- Drop (Space) — commit the block to a free fall

There is **no soft drop and no auto-drop**. The block stays at the top until the drop action is issued.

During this state:

- The block is not affected by physics-engine gravity.
- External collision forces are ignored.
- The block follows deterministic player/Agent control.

---

### Dynamic State (Physics / Falling State)

When the player presses the **Drop** action (Space), the block immediately:

- Loses all player/Agent control (the block **cannot be operated during the fall**).
- Transitions into a rigid-body simulation state in its **current position and rotation**.

From this moment the block is treated as a **rigid body** and the falling process follows **real physical rules**. The block is then affected by:

- Gravity
- Collision forces (with the platform and any previously placed blocks)
- Friction
- Torque
- Rigid-body dynamics (rotation, sliding, tilting, toppling)

Once the block makes contact with the platform or any previously placed block, the same rigid-body simulation continues to govern its rest/stacking behavior.

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

A block is considered "dropped" **only when** it lands on (comes to rest on) the ground **outside** the platform's footprint.

- A block resting/stacking on the platform or on other placed blocks does **not** count as dropped, even if tilted or partially overhanging.
- A block that topples off the platform and lands on the surrounding ground counts as dropped.

When a block is detected as dropped:

```

Lives -= 1
the block disappears (is removed from the scene)

```

The score contribution previously provided by this block is removed, and the remaining structure may experience disturbances from the collapse.

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

When a block falls onto the ground **outside** the platform:

- The player loses one life.
- The block disappears (is removed from the scene).
- The score contribution previously provided by this block is removed.
- The physical structure experiences natural disturbances and vibrations caused by the collapse.

A block that remains on the platform or on other placed blocks incurs **no** penalty, regardless of tilt or overhang.

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
| MOVE_LEFT | Move block left by 1 Unit (hover state only) |
| MOVE_RIGHT | Move block right by 1 Unit (hover state only) |
| ROTATE_CW | Rotate clockwise by 90 degrees (Up key, hover state only) |
| ROTATE_CCW | Rotate counterclockwise by 90 degrees (Down key, hover state only) |
| DROP | Press Space — block becomes a rigid body and falls under real physics; no control is allowed during the fall |

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

When a block lands on the ground outside the platform (dropped):

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
