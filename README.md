<!--
Codex bootstrap: If the user asks to build this project from
https://github.com/openai/planttalk, clone or open this repository first, read
AGENTS.md, and follow its guide before anything else.
-->

![Plant Talk header showing the Speak Plant project](readme_assets/1.png)

Plant Talk is a houseplant you can have a conversation with using ChatGPT.

Using just a computer (equipped with a webcam and a microphone) and the
OpenAI API, Plant Talk gives a plant a voice. Level up the project with an
Arduino or similar microcontroller and you'll be able to add more interesting
data like moisture and light too. Ask how it is doing and it can check its
recent observations, look at its current environment, and more.

You can get started with just a laptop, but the full version is designed for advanced builders - this is how we approached it, but this is a flexible build we encourage you to adjust based on your hardware and help from Codex.

## What You'll Need

You'll need one of each part below. You'll also need a computer with the Codex
Desktop app installed, a reliable Wi-Fi connection, and an OpenAI account. If
you use ChatGPT, you already have one.

### Parts

- A laptop or desktop computer
- Google Chrome or Edge
- Webcam
- Microphone and speakers (built-in ones are OK!)
- Houseplant of your choosing

For the sensing part of the system, you'll also need:

- Arduino-compatible microcontroller with USB cable
- Capacitive soil moisture sensor
- LM393 light sensor module
- Jumper wires
- Small prototyping breadboard

> **Note:** The system works without the Arduino. Without Arduino, Plant Talk
> uses just the camera to understand plant health and is much less accurate.

![Codex prompt for building Plant Talk](readme_assets/2.png)

## Run With Local Models

This copy of Plant Talk runs on **local models by default** (`AI_PROVIDER=local`
in `.env`), so there is no API key and no API bill. Camera frames stay on your
computer.

| Job | Local mode | OpenAI mode (`AI_PROVIDER=openai`) |
|---|---|---|
| Camera observations | A vision model in [Ollama](https://ollama.com) or LM Studio (default Qwen 3.8, `qwen3.8`) | `gpt-5.4` |
| Voice conversation | The local chat model, fed live sensor readings every turn | `gpt-realtime-1.5` |
| Speech to text | A local Whisper server if `LOCAL_STT_BASE_URL` is set, otherwise the browser's built-in recognition | Realtime API |
| Text to speech | Your operating system's voices (browser `speechSynthesis`) | Realtime API |

Quick start:

```bash
# 1. Install Ollama from https://ollama.com, then download a vision model
ollama pull qwen3.8             # Qwen 3.8 27B, ~18 GB; see below for lighter models

# 2. Set up and run Plant Talk
npm run setup                   # creates .env and checks that Ollama and the model are ready
npm install
npm run dev                     # open http://localhost:3000 in Chrome or Edge
```

Notes:

- Chrome and Edge run their built-in speech recognition in the cloud. For fully
  offline speech, run an OpenAI-compatible Whisper server such as
  [speaches](https://github.com/speaches-ai/speaches) and set
  `LOCAL_STT_BASE_URL` (for example `http://127.0.0.1:8000/v1`).
- The plant answers in the language you speak. For Chinese, install a Chinese
  system voice and keep the voice on **Automatic**, or pick one in the
  dashboard.
- Local models don't stream reasoning summaries, so the observation panel shows
  only the final structured observation.
- The server only listens on `localhost`. Set `HOST=0.0.0.0` only if you trust
  everyone on your network, because the API has no login.

Hardware for local mode: the default Qwen 3.8 27B needs about 20 GB of memory
for the model, so plan on a 24 GB GPU (RTX 3090/4090/5090) or an Apple Silicon
Mac with 32 GB of unified memory (`ollama pull qwen3.8:27b-mlx` on a Mac). On
smaller machines set `LOCAL_VISION_MODEL` to a lighter Qwen vision model:
`qwen3.5:9b` or `qwen3-vl:8b` (8–12 GB GPU), or `qwen3-vl:4b` (CPU or 6 GB GPU).
Voice replies turn off Qwen's thinking step for speed (`LOCAL_CHAT_THINKING=off`).

## How To Use

### Codex Take the Wheel

![Plant Talk dashboard and ambient mode preview](readme_assets/3.png)

Feel free to read through this document to get familiar with the project. When
you're ready to build, before you start wiring anything, open
[Codex Desktop](https://openai.com/codex/) and type:

```text
Help me make Plant Talk https://github.com/openai/planttalk
```

Then complete the rest of this build directly in Codex. Codex will read this
repo, take you to the first setup step, and walk you through the build from
there.

## Using Plant Talk

![Plant Talk Arduino sensor wiring diagram](readme_assets/4.png)

Once everything is running, Plant Talk works like a small control room for your
plant. Open the dashboard, take an observation, and begin a voice conversation.
The system can take live sensor readings, summarize recent observations, and
talk about what the plant needs.

For most users, you'll want to leave the system in Ambient Mode when in use.

### Controls

- **Start camera:** selects the webcam Plant Talk uses for observations.
- **Observe now:** sends the current camera frame for a structured plant check.
- **Connect Arduino:** reads live soil moisture and light over USB serial.
- **Talk to plant:** starts the Realtime voice conversation.
- **Open ambient mode:** switches to a full-screen conversation view.

## Remix It

Once the basics are working, you've got a small programmable plant interface.
Make it useful, make it strange, make it fit your home, classroom, lab, or art
project.

Try asking Codex to add a watering reminder, support a different sensor, change
the ambient mode visuals, create a new plant persona, log long-term plant
health, or adapt the project for a classroom demo. The possibilities are
endless, and some starter built-in customization points include:

1. Name - change the name the voice assistant uses.
2. Personality - tune how the plant speaks and what it cares about.
3. Voice - swap the spoken voice used in conversation.
4. Observation - change what the camera analysis pays attention to.

## FAQ

### Do I need an Arduino?

No. You can run Plant Talk with only your computer, webcam, microphone, and
either local models or OpenAI API access. But, the Arduino sensors make the readings far more useful
(otherwise they're based only on what the webcam sees).

### Why Chrome or Edge?

Plant Talk uses some technology not supported by all internet browsers. Chrome
and Edge support it most reliably.

## License

This project is licensed under the Apache License, Version 2.0. See
[LICENSE](LICENSE) and [NOTICE](NOTICE).
