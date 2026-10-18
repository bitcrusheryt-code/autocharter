# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who create rhythm-game charts from audio. The intended audience beyond the project owner is not yet specified.

## Product Purpose

Autocharter primarily generates rhythm-game charts from songs. Converting existing charts is a secondary workflow. Users can also play and test charts in the app using the rhythm-game modes already supported by its autocharter.

## Positioning

The confirmed product mechanism is a single app that combines chart generation, chart conversion, and playtesting. Autocharting is the primary task; conversion and playtesting support it.

## Operating Context

The project is a web app built with React, TypeScript, and Vite. Charts and media are imported from local files, and the app keeps user charts in browser storage.

## Capabilities and Constraints

- Current chart-generation and play modes include osu!mania, Friday Night Funkin', Lightners Live+, and Taiko.
- The app also supports its native `.iric` package format.
- Preserve the existing autocharting system and its generation controls.
- osu!mania is the known-good mode for the owner and must remain the regression control; avoid intentional changes to its behavior.
- Keep the current supported game modes in scope; choosing any additional rhythm games is deferred until the project is stable.
- The product's exact external user audience and any broader market positioning remain undecided.

## Brand Commitments

- The product is referred to as Autocharter.
- The owner wants an interface that feels specific to the product rather than like a generic AI-made UI. Their design criteria favor color with a real purpose, clear hierarchy from typography/space/alignment, task-focused screens, prominent important actions, purposeful effects, realistic content and edge states, and a distinct product identity.

## Product Principles

1. Make automatic chart creation the clearest and most complete workflow.
2. Keep conversion directly accessible as a secondary workflow.
3. Let users play or test charts in the modes supported by chart generation.
4. Preserve the known-good osu!mania behavior while improving other modes.
5. Do not invent product claims or add game modes before the owner chooses them.
