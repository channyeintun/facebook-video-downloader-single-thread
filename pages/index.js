"use client";
import React from "react";
import { createFFmpeg } from "@ffmpeg/ffmpeg";
import {
    Modal,
    NetworkMonitor,
    MediaOptions,
    VideoPlayer,
    SaveIcon,
} from "../components/";
import {
    fetchFile,
    Cleaner,
    extractVideoLinks,
    extractAudioLink,
    extractTitle,
    extractThumbnail,
} from "../utils";

export default class Home extends React.Component {
    state = {
        contentLength: 0,
        chunkSize: 0,
        videoSrc: "",
        resourceStr: "",
        resolutions: [],
        selectedQuality: "",
        loading: false,
        isLoaded: false,
        isModalVisible: false,
        isSupported: false,
        fileName: "",
        error: "",
        controller: null,
        proxy: false,
        thumbnail: null,
    };

    update = (newObj) => {
        this.setState((prevState) => ({
            ...prevState,
            ...newObj,
        }));
    };

    async componentDidMount() {
        if (typeof window !== undefined && !this.ffmpeg) {
            this.ffmpeg = createFFmpeg({
                log: true,
                corePath: new URL("/ffmpeg-core.js", document.location).href,
            });
        }

        if (crossOriginIsolated) {
            console.log("SharedArrayBuffer enabled.");
            if (!this.ffmpeg.isLoaded()) {
                await this.ffmpeg.load().catch((err) => {
                    console.error(err);
                    this.update({ error: err.message });
                });
                this.ffmpeg.setProgress(({ ratio }) => {
                    console.log("parsing", parseInt(ratio * 100) + "%");
                });
            }
            this.update({
                isLoaded: true,
                isSupported: true,
            });
        } else {
            this.update({
                isLoaded: true,
            });
        }
    }

    async mergeVideo(video, audio, options) {
        const videoFile = await fetchFile(video, options);
        if (videoFile?.length > 0) {
            this.ffmpeg.FS("writeFile", "video.mp4", videoFile);
        }

        const audioFile = await fetchFile(audio, options);
        if (audioFile?.length > 0) {
            this.ffmpeg.FS("writeFile", "audio.mp4", audioFile);
        }

        if (videoFile?.length === 0 || audioFile?.length === 0) {
            throw new Error("Download has stopped.");
        }

        await this.ffmpeg.run(
            "-i",
            "video.mp4",
            "-i",
            "audio.mp4",
            "-c",
            "copy",
            "output.mp4"
        );
        let data = await this.ffmpeg.FS("readFile", "output.mp4");
        return data;
    }

    async deleteFiles() {
        const files = ["audio.mp4", "video.mp4", "output.mp4"];
        files.forEach((file) => this.deleteFile(file));
    }

    async deleteFile(file) {
        try {
            this.ffmpeg.FS("unlink", file);
            console.log(`Successfully deleted ${file}`);
        } catch (error) {
            console.error(`Error deleting file: ${error}`);
        }
    }

    onChangeInput = (e) => {
        const cleaner = new Cleaner(e.target.value);
        let resourceStr = cleaner.clean(["u003C", "\\", "amp;"]).value;

        const title = extractTitle(resourceStr);
        this.update({
            resourceStr,
            fileName: title,
            resolutions: [],
            selectedQuality: "",
        });
    };

    checkHDhandler = () => {
        try {
            const links = extractVideoLinks(this.state.resourceStr);
            const thumbnail = extractThumbnail(this.state.resourceStr);
            
            const resolutions = links.map((item, index) => ({
                videoId: item.videoId,
                qualityClass: item.qualityClass,
                qualityLabel: item.qualityLabel || (item.qualityClass === "hd" ? "HD Quality" : "SD Quality"),
                url: item.url,
                key: item.key || `${item.qualityClass}_${index}`,
            }));
            
            this.update({
                resolutions,
                thumbnail,
                isModalVisible: true,
            });
        } catch (error) {
            this.update({
                error: error.message,
                isModalVisible: false,
            });
        }
    };

    extractLinkHandler = async () => {
        const { resourceStr, selectedQuality, resolutions } = this.state;
        const controller = new AbortController();
        if (resourceStr && selectedQuality) {
            try {
                this.update({
                    loading: true,
                    isModalVisible: false,
                    error: "",
                    controller,
                });

                // Find the selected resolution
                const selectedResolution = resolutions.find(
                    (res) => res.key === selectedQuality
                );
                if (!selectedResolution) {
                    this.update({
                        loading: false,
                        error: "Selected resolution not found.",
                    });
                    return;
                }

                const video_link = selectedResolution.url;
                console.log("video_link", video_link);
                if (!video_link) {
                    this.update({
                        loading: false,
                        error: "Video link not found.",
                    });
                    return;
                }

                let audio_link = null;
                try {
                    audio_link = extractAudioLink(resourceStr);
                } catch (e) {
                    // No audio found, not an error
                    audio_link = null;
                }
                console.log("audio_link", audio_link);

                const getContentLength = (length) =>
                    this.update({
                        contentLength: length + this.state.contentLength,
                    });

                let fileData;
                if (audio_link) {
                    // Download and merge video and audio
                    fileData = await this.mergeVideo(video_link, audio_link, {
                        getContentLength,
                        controller,
                        proxy: this.state.proxy,
                    });
                } else {
                    // Only download video, no merging
                    fileData = await fetchFile(video_link, {
                        getContentLength,
                        controller,
                        proxy: this.state.proxy,
                    });
                }

                // Create a blob and set videoSrc
                const blob = new Blob([fileData], { type: "video/mp4" });
                const videoSrc = URL.createObjectURL(blob);
                this.update({
                    videoSrc,
                    loading: false,
                });
            } catch (error) {
                this.update({
                    error: error.message,
                    loading: false,
                });
            }
        }
    };

    selectMedia = (e) => {
        console.log('selectMedia called with:', e.target.value);
        console.log('Current resolutions:', this.state.resolutions.length);
        this.update({
            selectedQuality: e.target.value,
        });
    };

    hideModal = () => {
        this.update({
            isModalVisible: false,
        });
    };

    cleanVideo = () => {
        const videoSrc = this.state.videoSrc;
        this.update({ videoSrc: "", resourceStr: "", resolutions: [], selectedQuality: "" });
        URL.revokeObjectURL(videoSrc);
    };

    cancelDownload = () => {
        this.state.controller?.abort();
        this.update({
            chunkSize: 0,
            contentLength: 0,
        });
    };

    render() {
        const contentLengthInMB = (this.state.contentLength / 1048576).toFixed(2);
        const chunkSizeInMB = (this.state.chunkSize / 1048576).toFixed(2);
        return (
            <>
                <div className="container">
                    <div className="main-content">
                        {this.state.isSupported ? (
                            <>
                                <div className="header">
                                    <h1>Facebook Video Downloader</h1>
                                    <p className="subtitle">Download Facebook videos in HD quality with audio</p>
                                    <div className="how-to-use">
                                        <a href="https://youtu.be/v_JJgJc9KjM" target="_blank" rel="noopener noreferrer" className="youtube-link">
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{verticalAlign: 'middle', marginRight: '8px'}}><rect width="24" height="24" rx="12" fill="#FF0000"/><path d="M10 15.5V8.5L16 12L10 15.5Z" fill="white"/></svg>
                                            How to use (YouTube)
                                        </a>
                                    </div>
                                </div>
                                
                                <div className="input-section">
                                    <label htmlFor="source-input" className="input-label">
                                        Paste Facebook video source code:
                                    </label>
                                    <textarea
                                        id="source-input"
                                        value={this.state.resourceStr}
                                        className="input-box"
                                        placeholder="Go to the Facebook video → Right click → View page source → Select all (Ctrl+A) → Copy → Paste here"
                                        onChange={this.onChangeInput}
                                    ></textarea>
                                </div>

                                <div className="action-section">
                                    {this.state.loading ? (
                                        <button
                                            onClick={this.cancelDownload}
                                            className="action-button cancel-button"
                                        >
                                            Cancel Download
                                        </button>
                                    ) : this.state.videoSrc ? (
                                        <button
                                            onClick={this.cleanVideo}
                                            className="action-button clear-button"
                                        >
                                            Start New Download
                                        </button>
                                    ) : (
                                        <div className="check-section">
                                            <button
                                                onClick={this.checkHDhandler}
                                                className="action-button primary-button"
                                                disabled={!this.state.resourceStr.trim()}
                                            >
                                                Check Available Media
                                            </button>
                                            <div className="proxy-option">
                                                <input
                                                    id="proxy"
                                                    checked={this.state.proxy}
                                                    onChange={(e) =>
                                                        this.setState({ proxy: e.target.checked })
                                                    }
                                                    type="checkbox"
                                                    className="proxy-checkbox"
                                                />
                                                <label htmlFor="proxy" className="proxy-label">
                                                    <span>Use Proxy</span>
                                                    <small>(Enable if download fails)</small>
                                                </label>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {this.state.loading && (
                                    <div className="progress-section">
                                        <div className="progress-content">
                                            <div className="progress-text">
                                                <p>Downloading and processing video...</p>
                                                <NetworkMonitor
                                                    contentLength={contentLengthInMB}
                                                    chunkSize={chunkSizeInMB}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {this.state.error && (
                                    <div className="error-section">
                                        <div className="error-content">
                                            <h3>Error</h3>
                                            <p>{this.state.error}</p>
                                        </div>
                                    </div>
                                )}

                                {this.state.videoSrc && (
                                    <div className="result-section">
                                        <div className="download-section">
                                            <h3>Download Video</h3>
                                            <div className="save-controls">
                                                <input
                                                    value={this.state.fileName}
                                                    onChange={(e) =>
                                                        this.update({
                                                            fileName: e.target.value,
                                                        })
                                                    }
                                                    className="file-name-input"
                                                    placeholder="Enter filename (without extension)"
                                                />
                                                {this.state.fileName ? (
                                                    <a
                                                        className="download-button"
                                                        href={this.state.videoSrc}
                                                        download={this.state.fileName + '.mp4'}
                                                    >
                                                        <SaveIcon />
                                                        Download
                                                    </a>
                                                ) : (
                                                    <button className="download-button disabled">
                                                        <SaveIcon />
                                                        Download
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <VideoPlayer videoSrc={this.state.videoSrc} />
                                    </div>
                                )}
                            </>
                        ) : this.state.isLoaded ? (
                            <div className="error-section">
                                <h1>Browser Not Supported</h1>
                                <p>Please use a modern browser that supports SharedArrayBuffer.</p>
                            </div>
                        ) : (
                            <div className="loading-section">
                                <h2>Loading application...</h2>
                            </div>
                        )}
                    </div>
                </div>
                <Modal visible={this.state.isModalVisible}>
                    <div className="modal-content">
                        <h2 className="modal-title">Select Video Quality</h2>
                        <p className="modal-subtitle">Choose the quality you want to download</p>
                        <MediaOptions
                            resolutions={this.state.resolutions}
                            selectMedia={this.selectMedia}
                            selectedQuality={this.state.selectedQuality}
                            thumbnail={this.state.thumbnail}
                        />
                        <div className="modal-footer">
                            <button onClick={this.hideModal} className="modal-button secondary">
                                Cancel
                            </button>
                            <button
                                className={`modal-button primary ${
                                    this.state.loading || !this.state.selectedQuality ? "disabled" : ""
                                }`}
                                onClick={this.extractLinkHandler}
                                disabled={this.state.loading || !this.state.selectedQuality}
                            >
                                {this.state.loading ? "Processing..." : "Download Selected"}
                            </button>
                        </div>
                    </div>
                </Modal>
                <style jsx>{`
                    .container {
                        min-height: 100vh;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        padding: 2rem 1rem;
                    }

                    .main-content {
                        max-width: 800px;
                        margin: 0 auto;
                        background: white;
                        border-radius: 20px;
                        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
                        overflow: hidden;
                    }

                    .header {
                        background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
                        color: white;
                        padding: 3rem 2rem;
                        text-align: center;
                    }

                    .header h1 {
                        font-size: 2.5rem;
                        font-weight: 700;
                        margin: 0 0 0.5rem 0;
                        color: white;
                    }

                    .subtitle {
                        font-size: 1.1rem;
                        opacity: 0.9;
                        margin: 0;
                    }

                    .how-to-use {
                        margin-top: 1rem;
                        text-align: center;
                    }

                    .youtube-link {
                        display: inline-flex;
                        align-items: center;
                        color: #fff;
                        background: #ff0000;
                        padding: 0.5rem 1rem;
                        border-radius: 8px;
                        font-weight: 600;
                        text-decoration: none;
                        transition: background 0.2s;
                        font-size: 1rem;
                    }

                    .youtube-link:hover {
                        background: #c20000;
                        color: #fff;
                    }

                    .input-section {
                        padding: 2rem;
                    }

                    .input-label {
                        display: block;
                        font-weight: 600;
                        color: #374151;
                        margin-bottom: 0.5rem;
                        font-size: 1rem;
                    }

                    .input-box {
                        width: 100%;
                        min-height: 140px;
                        border: 2px solid #e5e7eb;
                        border-radius: 12px;
                        padding: 1rem;
                        font-size: 0.95rem;
                        color: #374151;
                        background: #f9fafb;
                        resize: vertical;
                        transition: all 0.3s ease;
                        font-family: inherit;
                    }

                    .input-box:focus {
                        outline: none;
                        border-color: #4f46e5;
                        background: white;
                        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
                    }

                    .action-section {
                        padding: 0 2rem 2rem;
                    }

                    .check-section {
                        display: flex;
                        flex-direction: column;
                        gap: 1rem;
                    }

                    .action-button {
                        width: 100%;
                        padding: 1rem 2rem;
                        border: none;
                        border-radius: 12px;
                        font-size: 1rem;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 0.5rem;
                    }

                    .primary-button {
                        background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
                        color: white;
                    }

                    .primary-button:hover:not(:disabled) {
                        transform: translateY(-2px);
                        box-shadow: 0 10px 25px rgba(79, 70, 229, 0.3);
                    }

                    .primary-button:disabled {
                        background: #9ca3af;
                        cursor: not-allowed;
                        transform: none;
                        box-shadow: none;
                    }

                    .cancel-button {
                        background: #ef4444;
                        color: white;
                    }

                    .cancel-button:hover {
                        background: #dc2626;
                        transform: translateY(-2px);
                        box-shadow: 0 10px 25px rgba(239, 68, 68, 0.3);
                    }

                    .clear-button {
                        background: #10b981;
                        color: white;
                    }

                    .clear-button:hover {
                        background: #059669;
                        transform: translateY(-2px);
                        box-shadow: 0 10px 25px rgba(16, 185, 129, 0.3);
                    }

                    .proxy-option {
                        display: flex;
                        align-items: center;
                        gap: 0.75rem;
                        padding: 1rem;
                        background: #f3f4f6;
                        border-radius: 12px;
                    }

                    .proxy-checkbox {
                        width: 1.25rem;
                        height: 1.25rem;
                        accent-color: #4f46e5;
                    }

                    .proxy-label {
                        display: flex;
                        flex-direction: column;
                        color: #374151;
                        cursor: pointer;
                    }

                    .proxy-label small {
                        color: #6b7280;
                        font-size: 0.85rem;
                    }

                    .progress-section {
                        padding: 2rem;
                        background: #f8fafc;
                        border-top: 1px solid #e2e8f0;
                    }

                    .progress-content {
                        display: flex;
                        align-items: center;
                        gap: 1.5rem;
                        justify-content: center;
                        flex-direction: column;
                    }

                    .progress-text {
                        text-align: center;
                    }

                    .progress-text p {
                        color: #475569;
                        font-weight: 500;
                        margin: 0 0 1rem 0;
                        font-size: 1.1rem;
                    }

                    .error-section {
                        padding: 2rem;
                        background: #fef2f2;
                        border-top: 1px solid #fecaca;
                    }

                    .error-content {
                        text-align: center;
                        color: #dc2626;
                    }

                    .error-content h3 {
                        margin: 0 0 0.5rem 0;
                        color: #dc2626;
                    }

                    .error-content p {
                        margin: 0;
                        color: #991b1b;
                    }

                    .result-section {
                        padding: 2rem;
                        background: #f0fdf4;
                        border-top: 1px solid #bbf7d0;
                    }

                    .download-section h3 {
                        color: #166534;
                        margin: 0 0 1rem 0;
                        text-align: center;
                    }

                    .save-controls {
                        display: flex;
                        gap: 1rem;
                        margin-bottom: 2rem;
                    }

                    .file-name-input {
                        flex: 1;
                        padding: 0.75rem 1rem;
                        border: 2px solid #d1fae5;
                        border-radius: 8px;
                        font-size: 1rem;
                        color: #374151;
                    }

                    .file-name-input:focus {
                        outline: none;
                        border-color: #10b981;
                        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
                    }

                    .download-button {
                        display: flex;
                        align-items: center;
                        gap: 0.5rem;
                        padding: 0.75rem 1.5rem;
                        background: #10b981;
                        color: white;
                        text-decoration: none;
                        border-radius: 8px;
                        font-weight: 600;
                        transition: all 0.3s ease;
                        border: none;
                        cursor: pointer;
                    }

                    .download-button:hover:not(.disabled) {
                        background: #059669;
                        transform: translateY(-2px);
                        box-shadow: 0 8px 20px rgba(16, 185, 129, 0.3);
                    }

                    .download-button.disabled {
                        background: #9ca3af;
                        cursor: not-allowed;
                        transform: none;
                        box-shadow: none;
                    }

                    .loading-section {
                        padding: 4rem 2rem;
                        text-align: center;
                        color: #374151;
                    }

                    .loading-section h2 {
                        margin: 1rem 0 0 0;
                        color: #374151;
                        font-weight: 500;
                    }

                    .modal-content {
                        min-width: 500px;
                        max-width: 90vw;
                    }

                    .modal-title {
                        color: #1f2937;
                        text-align: center;
                        margin: 0 0 0.5rem 0;
                        font-size: 1.5rem;
                    }

                    .modal-subtitle {
                        color: #6b7280;
                        text-align: center;
                        margin: 0 0 1.5rem 0;
                    }

                    .modal-footer {
                        display: flex;
                        gap: 1rem;
                        margin-top: 2rem;
                        justify-content: flex-end;
                    }

                    .modal-button {
                        padding: 0.75rem 1.5rem;
                        border-radius: 8px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        border: none;
                    }

                    .modal-button.primary {
                        background: #4f46e5;
                        color: white;
                    }

                    .modal-button.primary:hover:not(.disabled) {
                        background: #4338ca;
                        transform: translateY(-1px);
                    }

                    .modal-button.primary.disabled {
                        background: #9ca3af;
                        cursor: not-allowed;
                        transform: none;
                    }

                    .modal-button.secondary {
                        background: transparent;
                        color: #374151;
                        border: 2px solid #d1d5db;
                    }

                    .modal-button.secondary:hover {
                        background: #f3f4f6;
                        border-color: #9ca3af;
                    }

                    @media (max-width: 768px) {
                        .container {
                            padding: 1rem 0.5rem;
                        }

                        .header {
                            padding: 2rem 1rem;
                        }

                        .header h1 {
                            font-size: 2rem;
                        }

                        .input-section,
                        .action-section,
                        .progress-section,
                        .error-section,
                        .result-section {
                            padding: 1.5rem 1rem;
                        }

                        .modal-content {
                            min-width: auto;
                            width: 90vw;
                        }

                        .save-controls {
                            flex-direction: column;
                        }

                        .modal-footer {
                            flex-direction: column;
                        }
                    }
                `}</style>

                <style jsx global>{`
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }

                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                        line-height: 1.6;
                        color: #1f2937;
                        background: #f9fafb;
                    }

                    h1, h2, h3, h4, h5, h6 {
                        font-weight: 700;
                        line-height: 1.2;
                    }

                    button, input, textarea, select {
                        font-family: inherit;
                    }

                    .hide {
                        display: none !important;
                    }
                `}</style>
            </>
        );
    }
}