# Matrix

Matrix is a terminal-based transit departure board powered by the [Catenary API](https://catenarymaps.org) and built with [OpenTUI](https://github.com/sst/opentui).

## Installation

```bash
bun install
```

```bash
bun run src/main.tsx
```

## Build

```bash
bun build --compile --minify --sourcemap ./src/main.tsx --outfile matrix
```

## Run

```bash
./matrix
```

## Overview

Matrix provides real-time departure information for nearby transit routes using the Catenary API.  
It supports automatic location detection, manual coordinate entry, and stop-based search, all within a keyboard-driven terminal interface.

Designed for both personal use and display systems, Matrix serves as a lightweight drop-in replacement for digital signage, offering live updates directly from the terminal — no browser required.

This project was created using `bun create tui`.  
[`create-tui`](https://git.new/create-tui) is the easiest way to get started with OpenTUI.
