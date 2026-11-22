---
name: ui-ux-pro
description: Professional UI/UX standards, design system rules, and Web3 trading interface best practices.
---

# UI/UX Pro Design System & Guidelines

## 1. Web3 Trading Interface Principles
- **No Mystery Reverts**: Never present cryptic EVM execution revert strings (`-32603`, `execution reverted`, `0x`, `could not coalesce error`) to the user. Always parse, sanitize, and explain in plain English.
- **Transaction Lifecycle Transparency**: Web3 users must always clearly understand state transitions:
  1. `Idle`: Clear call-to-action with disabled states explaining why (e.g. "Connect Wallet", "Enter Amount", "Approve LINK").
  2. `Awaiting Confirmation`: Explicit prompt indicating the user should confirm in their wallet.
  3. `Pending`: Tx hash linked to explorer with spinner and confirmation status.
  4. `Confirmed / Success`: Distinct visual affirmation with clean state reset.
  5. `Rejection / Error`: Graceful error recovery without locking the user out or clearing their inputs unnecessarily.

## 2. Visual Hierarchy & Dark Trading Terminal Aesthetics
- **Dark Neutral Canvas**: Deep slate/charcoal backgrounds (`#0a0c16`, `#0f1220`, `#161a2e`) with crisp, low-opacity borders (`#2a2f45`, `#1d2235`).
- **Accent Signals**:
  - Positive / Executed: Vibrant emerald (`#10b981`, `#064e3b`).
  - Pending / Open: Golden amber (`#f59e0b`, `#451a03`).
  - Action / Destructive / Cancel: Crisp coral red (`#ef4444`, `#450a0a`).
  - Neutral / Muted: Steel slate (`#8b90a7`, `#5c6175`).
- **Typography & Alignment**:
  - Monospace or system tabular numbers for crypto balances, order IDs, and currency amounts.
  - Right-align numeric columns (Prices, Amounts, Status).
  - Left-align categorical columns (Tokens, Addresses, IDs).
  - Truncate long hashes/addresses gracefully with ellipsis (`0x33F2...710b`).

## 3. Order Management & Settlement UX
- **Listed Trades**:
  - Open orders with live oracle pricing.
  - One-click Cancel button with clear loading feedback (`Cancel` -> `Cancelling...`).
- **Settled Trades**:
  - Filter and badge both **Executed** (green/neutral) and **Cancelled** (muted red/rose).
  - Show historical fill price or cancellation timestamp.
- **In-Browser Match Engine**:
  - Surface automatic order pairing directly in the UI. If a complementary pair is detected on-chain, display an interactive "Match & Settle" notification or execute automatically so users do not need terminal scripts.

