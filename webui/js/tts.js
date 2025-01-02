const tts = {
    ttsUrl: null,               // URL endpoint for TTS generation
    audioContext: null,         // AudioContext for managing audio playback
    isInitialized: false,       // Flag to ensure initialization occurs only once

    async init() {
        if (this.isInitialized) return; // Prevent re-initialization
        
        try {
            const response = await fetch('/settings_get');
            if (!response.ok) {
                throw new Error(`Failed to fetch settings: ${response.statusText}`);
            }

            const data = await response.json();
            const ttsSection = data.settings.sections.find(
                section => section.title === "Text-To-Speech"
            );

            if (!ttsSection || !ttsSection.fields || !ttsSection.fields.length) {
                throw new Error("Text-To-Speech settings are missing or malformed.");
            }

            this.ttsUrl = ttsSection.fields[0].value;
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.isInitialized = true;
            console.log("TTS module initialized successfully.");
        } catch (error) {
            window.toastFetchError("Error getting TTS settings", error);
            console.error("TTS Initialization Error:", error);
        }
    },

    /**
     * Reads the provided text out loud using the TTS backend.
     * @param {string} text - The text to be read aloud.
     * @param {string} [voice='af_sky'] - (Optional) The voice to use for TTS.
     * @param {Function} [onStatusChange] - (Optional) Callback to handle status updates.
     */
    async process(text, voice = 'af_sky', onStatusChange = null) {
        if (!this.isInitialized) {
            console.error("TTS module is not initialized. Call TTS.init() first.");
            return;
        }

        if (!text || typeof text !== 'string') {
            console.error("Invalid text provided for TTS.");
            return;
        }

        // Update status if callback is provided
        if (onStatusChange) onStatusChange("Generating audio...");

        try {

            console.log(this.ttsUrl);

            const response = await fetch(this.ttsUrl + "/generate", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, voice })
            });

            console.log(response);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Unknown error from TTS backend.');
            }

            const reader = response.body.getReader();
            let buffer = new Uint8Array();  // Buffer to accumulate incoming data
            let currentTime = this.audioContext.currentTime;

            /**
             * Processes a single WAV chunk by decoding and scheduling it for playback.
             * @param {ArrayBuffer} wavBuffer - The raw WAV data buffer.
             */
            const processWavChunk = async (wavBuffer) => {
                try {
                    const audioBuffer = await this.audioContext.decodeAudioData(wavBuffer);
                    const source = this.audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(this.audioContext.destination);
                    source.start(currentTime);
                    currentTime += audioBuffer.duration;
                    console.log(`Playing chunk: ${audioBuffer.duration} seconds`);
                } catch (decodeError) {
                    console.error('Error decoding WAV chunk:', decodeError);
                }
            };

            /**
             * Parses the streaming response and processes each WAV chunk.
             * @param {ReadableStreamDefaultReader} reader - The stream reader.
             */
            const parseStream = async (reader) => {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    if (value && value.length > 0) {
                        // Append new data to the buffer
                        const tmp = new Uint8Array(buffer.length + value.length);
                        tmp.set(buffer, 0);
                        tmp.set(value, buffer.length);
                        buffer = tmp;
                    }

                    let offset = 0;
                    while (true) {
                        // Ensure there's enough data to read the length prefix
                        if (buffer.length - offset < 4) break;

                        // Read the 4-byte big-endian length prefix
                        const wavLength = (
                            (buffer[offset] << 24) |
                            (buffer[offset + 1] << 16) |
                            (buffer[offset + 2] << 8) |
                            (buffer[offset + 3])
                        ) >>> 0; // Force unsigned

                        // Check if the full WAV chunk is available
                        if (buffer.length - offset - 4 < wavLength) break;

                        // Extract the WAV data chunk
                        const chunkStart = offset + 4;
                        const chunkEnd = chunkStart + wavLength;
                        const wavData = buffer.slice(chunkStart, chunkEnd);

                        // Validate the WAV header (RIFF)
                        if (
                            wavData[0] !== 0x52 || // 'R'
                            wavData[1] !== 0x49 || // 'I'
                            wavData[2] !== 0x46 || // 'F'
                            wavData[3] !== 0x46    // 'F'
                        ) {
                            console.error("Invalid WAV file: Missing RIFF header.");
                        } else {
                            // Process the valid WAV chunk
                            await processWavChunk(wavData.buffer);
                        }

                        // Move the offset past the processed chunk
                        offset = chunkEnd;
                    }

                    // Remove processed data from the buffer
                    if (offset > 0) {
                        buffer = buffer.slice(offset);
                    }
                }
            };

            // Start parsing the stream
            await parseStream(reader);

            // Update status upon completion
            if (onStatusChange) onStatusChange("Audio playback completed.");
            console.log("Audio playback completed.");
        } catch (error) {
            console.error('Error during TTS processing:', error);
            if (onStatusChange) onStatusChange("");
            window.toastFetchError("Error generating or playing audio", error);
        }
    }
};

// Initialize the TTS module once the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    window.tts = tts;
    window.tts.init();
});
