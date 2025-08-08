import React, { useState, useEffect, useRef } from 'react';

export function MediaOptions({ videos = [], selectVideo, selectQuality, selectedVideoKey, selectedQuality }) {
    const [focusedVideoIndex, setFocusedVideoIndex] = useState(-1);
    const videoListRef = useRef(null);

    useEffect(() => {
        // Auto-focus the first video if none is selected and there are multiple videos
        if (videos.length > 1 && !selectedVideoKey) {
            setFocusedVideoIndex(0);
        } else if (selectedVideoKey) {
            const index = videos.findIndex(v => v.key === selectedVideoKey);
            setFocusedVideoIndex(index);
        } else {
            setFocusedVideoIndex(-1);
        }
    }, [videos, selectedVideoKey]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (videos.length <= 1) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocusedVideoIndex(prev => (prev + 1) % videos.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocusedVideoIndex(prev => (prev - 1 + videos.length) % videos.length);
            } else if (e.key === 'Enter' && focusedVideoIndex !== -1) {
                e.preventDefault();
                selectVideo(videos[focusedVideoIndex].key);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [videos, focusedVideoIndex, selectVideo]);

    useEffect(() => {
        // Scroll focused video into view
        if (focusedVideoIndex !== -1 && videoListRef.current) {
            const videoElement = videoListRef.current.children[focusedVideoIndex];
            if (videoElement) {
                videoElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest'
                });
            }
        }
    }, [focusedVideoIndex]);

    const selectedVideo = videos.find(v => v.key === selectedVideoKey);

    return (
        <>
            <div className="media-options-container">
                {videos.length > 0 ? (
                    <div className="content-wrapper">
                        {videos.length > 1 && (
                            <div className="video-list-container">
                                <h4 className="list-title">Select a Video</h4>
                                <div className="video-list" ref={videoListRef}>
                                    {videos.map((video, index) => (
                                        <div
                                            key={video.key}
                                            className={`video-item ${selectedVideoKey === video.key ? 'selected' : ''} ${focusedVideoIndex === index ? 'focused' : ''}`}
                                            onClick={() => selectVideo(video.key)}
                                            onMouseOver={() => setFocusedVideoIndex(index)}
                                        >
                                            <img
                                                src={video.thumbnail || '/placeholder.png'}
                                                alt={`Video ${index + 1} thumbnail`}
                                                className="video-thumbnail"
                                                onError={(e) => { e.target.onerror = null; e.target.src='/placeholder.png'; }}
                                            />
                                            <div className="video-info">
                                                <span className="video-title">Video {index + 1}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="quality-selection-container">
                            {selectedVideo ? (
                                <div className="quality-controls">
                                    <div className="main-thumbnail-container">
                                        <img
                                            src={selectedVideo.thumbnail || '/placeholder.png'}
                                            alt="Selected video thumbnail"
                                            className="main-thumbnail"
                                            onError={(e) => { e.target.onerror = null; e.target.src='/placeholder.png'; }}
                                        />
                                    </div>
                                    <h4 className="quality-title">Choose Quality</h4>
                                    <div className="quality-buttons">
                                        {selectedVideo.resolutions.map(res => (
                                            <label
                                                key={res.key}
                                                className={`quality-option ${selectedQuality === res.key ? 'selected' : ''}`}
                                                htmlFor={res.key}
                                            >
                                                <input
                                                    id={res.key}
                                                    type="radio"
                                                    name="quality"
                                                    onChange={() => selectQuality(res.key)}
                                                    value={res.key}
                                                    checked={selectedQuality === res.key}
                                                    className="quality-input"
                                                />
                                                <div className="quality-button">
                                                    <span className="quality-badge">{res.qualityLabel}</span>
                                                    <span className="quality-description">{res.qualityLabel === "HD" ? "High Definition" : "Standard Definition"}</span>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="no-selection">
                                    <div className="selection-icon">☝️</div>
                                    <h3>{videos.length > 1 ? "Select a video to see options" : "No video selected"}</h3>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="no-media">
                        <div className="no-media-icon">📹</div>
                        <h3>No Media Found</h3>
                        <p>Unable to find any video content in the provided source code.</p>
                    </div>
                )}
            </div>
            <style jsx>{`
                .media-options-container {
                    max-height: 70vh;
                    overflow-y: auto;
                    padding: 0.5rem;
                }
                .content-wrapper {
                    display: flex;
                    gap: 1.5rem;
                }
                .video-list-container {
                    flex: 1;
                    min-width: 200px;
                    max-width: 250px;
                }
                .list-title {
                    text-align: center;
                    font-size: 1.1rem;
                    margin-bottom: 1rem;
                    color: #4b5563;
                }
                .video-list {
                    max-height: 60vh;
                    overflow-y: auto;
                    padding-right: 8px;
                }
                .video-item {
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                    padding: 0.75rem;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                    border: 2px solid transparent;
                }
                .video-item:hover {
                    background-color: #f3f4f6;
                }
                .video-item.focused {
                    border-color: #a5b4fc;
                    background-color: #eef2ff;
                }
                .video-item.selected {
                    background-color: #e0e7ff;
                    border-color: #6366f1;
                }
                .video-thumbnail {
                    width: 80px;
                    height: 50px;
                    object-fit: cover;
                    border-radius: 4px;
                    background-color: #e5e7eb;
                }
                .video-info {
                    font-weight: 500;
                }
                .quality-selection-container {
                    flex: 2;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                .main-thumbnail-container {
                    margin-bottom: 1.5rem;
                    text-align: center;
                }
                .main-thumbnail {
                    max-width: 100%;
                    max-height: 220px;
                    border-radius: 12px;
                    object-fit: cover;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                }
                .quality-controls {
                    width: 100%;
                }
                .quality-title {
                    text-align: center;
                    font-size: 1.1rem;
                    margin-bottom: 1rem;
                    color: #374151;
                }
                .quality-buttons {
                    display: flex;
                    justify-content: center;
                    gap: 1rem;
                }
                .quality-option {
                    cursor: pointer;
                }
                .quality-input {
                    position: absolute;
                    opacity: 0;
                }
                .quality-button {
                    padding: 1rem 1.5rem;
                    border-radius: 8px;
                    border: 2px solid #e5e7eb;
                    background: #fff;
                    text-align: center;
                    transition: all 0.2s;
                    min-width: 120px;
                }
                .quality-option:hover .quality-button {
                    border-color: #c7d2fe;
                }
                .quality-option .quality-input:checked + .quality-button,
                .quality-option.selected .quality-button {
                    border-color: #4f46e5;
                    background-color: #eef2ff;
                    color: #3730a3;
                    transform: translateY(-2px);
                    box-shadow: 0 4px 10px rgba(79, 70, 229, 0.2);
                }
                .quality-badge {
                    font-weight: 600;
                }
                .quality-description {
                    font-size: 0.8rem;
                    color: #6b7280;
                    margin-top: 0.25rem;
                }
                .quality-option.selected .quality-description {
                     color: #4f46e5;
                }
                .no-selection, .no-media {
                    text-align: center;
                    color: #6b7280;
                }
                .selection-icon, .no-media-icon {
                    font-size: 3rem;
                    margin-bottom: 1rem;
                }

                /* Scrollbar for video list */
                .video-list::-webkit-scrollbar {
                    width: 6px;
                }
                .video-list::-webkit-scrollbar-thumb {
                    background: #cbd5e1;
                    border-radius: 3px;
                }

                @media (max-width: 768px) {
                    .content-wrapper {
                        flex-direction: column;
                    }
                    .video-list-container {
                        max-width: 100%;
                    }
                    .video-list {
                        display: flex;
                        overflow-x: auto;
                        overflow-y: hidden;
                        padding-bottom: 10px;
                        max-height: 120px;
                    }
                    .video-item {
                        flex-direction: column;
                        gap: 0.5rem;
                        min-width: 120px;
                    }
                }
            `}</style>
        </>
    );
}