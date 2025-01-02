document.addEventListener('DOMContentLoaded', async () => {
    // Element references
    const sttButton = document.getElementById('stt-button');
    const sttButtonStartIcon = document.getElementById('stt-button-start-icon');
    const sttButtonStopIcon = document.getElementById('stt-button-stop-icon');
    const sendButton = document.getElementById('send-button');
    const chatInput = document.getElementById('chat-input');

    // State variables
    let isRecording = false;
    let audioContext = null;
    let scriptNode = null;
    let input = null;
    let eventSource = null;
    let bufferQueue = [];
    let sttUrl = '';

    // Helper function to convert Float32Array to Int16Array
    function floatTo16BitPCM(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            let s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16Array;
    }

    // Function to start recording
    async function startRecording() {
        console.log("Start Recording");
        sttButton.setAttribute('aria-label', 'Stop recording');
        sttButton.classList.add("pulse");
        sttButtonStopIcon.classList.remove("hidden");
        sttButtonStartIcon.classList.add("hidden");
        isRecording = true;

        // Start SSE connection
        eventSource = new EventSource(`${sttUrl}/out`);

        eventSource.onmessage = (evt) => {
            console.log('Default message event:', evt.data);
        };

        eventSource.addEventListener('partial', (evt) => {
            const text = evt.data;
            console.log('Partial event:', text);
            // Update textarea with partial transcription
            chatInput.value = text;
        });

        eventSource.addEventListener('final', (evt) => {
            const text = evt.data;
            console.log('Final event:', text);
            // Update textarea with final transcription
            chatInput.value = text;

            // Trigger the send button
            sendButton.click();

            if (localStorage.getItem('continuousSTT') !== 'true') {
                // Stop recording after final transcription
                stopRecording();
            }
        });

        eventSource.onerror = (err) => {
            console.error('EventSource failed:', err);
            toast(`An error occured.`, "error");
            stopRecording();
        };

        // Access microphone and set up Web Audio API
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('Microphone access granted');

            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            input = audioContext.createMediaStreamSource(stream);

            // Create a ScriptProcessorNode with buffer size of 4096 and single input/output channel
            const bufferSize = 4096;
            const numberOfInputChannels = 1;
            const numberOfOutputChannels = 1;
            scriptNode = audioContext.createScriptProcessor(bufferSize, numberOfInputChannels, numberOfOutputChannels);

            // Handle audio processing
            scriptNode.onaudioprocess = async (audioProcessingEvent) => {
                const inputBuffer = audioProcessingEvent.inputBuffer;
                const channelData = inputBuffer.getChannelData(0); // Mono channel

                // Convert Float32Array to Int16Array (16-bit PCM)
                const pcmData = floatTo16BitPCM(channelData);

                // Ensure data length is multiple of 2 bytes
                if (pcmData.byteLength % 2 !== 0) {
                    console.warn('PCM data length is not a multiple of 2 bytes');
                    return;
                }

                // Queue the PCM data
                bufferQueue.push(pcmData);

                // Send the PCM data to the server
                try {
                    const response = await fetch(`${sttUrl}/in`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/octet-stream'
                        },
                        body: pcmData
                    });
                    if (!response.ok) {
                        console.error('Failed to send audio chunk:', response.statusText);
                    } else {
                        console.log('Audio chunk sent successfully');
                    }
                } catch (error) {
                    console.error('Error sending audio chunk:', error);
                }
            };

            // Connect the nodes
            input.connect(scriptNode);
            scriptNode.connect(audioContext.destination); // Necessary even if you don't want to hear the audio

            console.log('Audio processing started');
        } catch (err) {
            console.error('Failed to access microphone:', err);
            sttButton.setAttribute('aria-label', 'Start recording');
            isRecording = false;
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
        }
    }

    // Function to stop recording
    function stopRecording() {
        sttButton.setAttribute('aria-label', 'Start recording');
        sttButton.classList.remove("pulse");
        sttButtonStartIcon.classList.remove("hidden");
        sttButtonStopIcon.classList.add("hidden");
        isRecording = false;

        // Disconnect and clean up audio nodes
        if (scriptNode) {
            scriptNode.disconnect();
            scriptNode.onaudioprocess = null;
            scriptNode = null;
            console.log('ScriptProcessorNode disconnected');
        }

        if (audioContext) {
            audioContext.close();
            audioContext = null;
            console.log('AudioContext closed');
        }

        // Close SSE connection
        if (eventSource) {
            eventSource.close();
            eventSource = null;
            console.log('EventSource closed');
        }
    }

    // Event listener for STT button
    sttButton.addEventListener('click', () => {
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    });

    // Get settings from backend
    try {
        const response = await fetch('/settings_get');
        const data = await response.json();
        const settings = data.settings.sections.find(section => section.title === "Speech-To-Text").fields[0].value;
        sttUrl = settings;;
    } catch (e) {
        window.toastFetchError("Error getting settings", e);
    }
});
