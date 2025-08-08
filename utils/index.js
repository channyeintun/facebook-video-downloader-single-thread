export const fetchFile = async (_data, options = {}) => {
    const proxyUrl = '/api/proxy?url=' + encodeURIComponent(_data);
    const { getContentLength, progress, handleError, controller, proxy } = options;
    let data;
    try {
        if (typeof _data !== "string" || !_data) {
            throw new Error("Invalid URL or data is not passed");
        }
        const response = await fetch(proxy ? proxyUrl : _data, controller?.signal ? { signal: controller.signal } : {});
        if (!response.ok) {
            throw new Error(
                `Error ${response.status} - ${response.statusText}`
            );
        }
        if (typeof getContentLength === "function") {
            const length = response.headers.get("Content-Length");
            getContentLength(parseInt(length ?? 0));
        }
        const body = await response.body;
        const rs = consume(body);
        const blob = await new Response(rs).blob();
        data = await blob.arrayBuffer();
    } catch (err) {
        if (typeof handleError === "function") {
            handleError(err);
        } else {
            throw err;
        }
    }

    function consume(rs) {
        const reader = rs.getReader();
        return new ReadableStream({
            async start(controller) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }
                    if (typeof progress === "function") {
                        progress({ done, value });
                    }
                    controller.enqueue(value);
                }
                controller.close();
                reader.releaseLock();
            },
        });
    }
    return new Uint8Array(data);
};

export class Cleaner {
    constructor(raw_text = "") {
        this.value = raw_text;
    }
    clean(trashWords = []) {
        // Handle common JSON-escaped characters
        const escapeMap = {
            "u003C": "<",
            "u003E": ">",
            "u002F": "/",
            "u0026": "&",
            "u00253D": "=",
            "u0025": "%",
            "\\": "",
            "amp;": "&",
        };
        this.value = Object.keys(escapeMap).reduce(
            (text, key) => text.replaceAll(key, escapeMap[key]),
            this.value
        );
        trashWords.forEach((trash) => {
            this.value = this.value.replaceAll(trash, "");
        });
        return this;
    }
}

export function solveCors(link) {
    console.log("origin:", link);
    const regex = /(?<=video)(.*?)(?=.fbcdn)/s;
    return link.replace(regex, ".xx");
}

function extractCompleteJsonObject(str, startIndex) {
    let braceCount = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIndex; i < str.length; i++) {
        const char = str[i];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\' && inString) {
            escaped = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (!inString) {
            if (char === '{') {
                braceCount++;
            } else if (char === '}') {
                braceCount--;
                if (braceCount === 0) {
                    return str.substring(startIndex, i + 1);
                }
            }
        }
    }

    return null;
}

export function extractJsonFromHtml(htmlStr) {
    // Try to find JSON data in script tags first
    const scriptPattern = /<script[^>]*type=["']application\/json["'][^>]*>([^<]+)<\/script>/g;
    let match;

    while ((match = scriptPattern.exec(htmlStr)) !== null) {
        try {
            const jsonStr = match[1];
            const parsed = JSON.parse(jsonStr);

            // Check if this JSON has the structure we need
            if (parsed.extensions &&
                parsed.extensions.all_video_dash_prefetch_representations &&
                parsed.extensions.all_video_dash_prefetch_representations.length > 0) {
                return parsed;
            }

            if (parsed.data && parsed.extensions &&
                parsed.extensions.all_video_dash_prefetch_representations &&
                parsed.extensions.all_video_dash_prefetch_representations.length > 0) {
                return parsed;
            }
        } catch (e) {
            // Continue trying other matches
            continue;
        }
    }

    // If no JSON found in script tags, try to extract from the entire HTML
    // Look for the extensions pattern and extract the complete JSON object
    const extensionsPattern = /"extensions":\s*\{/g;
    let extensionsMatch;

    while ((extensionsMatch = extensionsPattern.exec(htmlStr)) !== null) {
        const startIndex = extensionsMatch.index + extensionsMatch[0].length - 1; // Start from the opening brace
        const completeJson = extractCompleteJsonObject(htmlStr, startIndex);

        if (completeJson) {
            try {
                const extensionsData = JSON.parse(completeJson);
                if (extensionsData.all_video_dash_prefetch_representations &&
                    extensionsData.all_video_dash_prefetch_representations.length > 0) {
                    return { extensions: extensionsData };
                }
            } catch (e) {
                console.error("Failed to parse extensions data:", e);
                continue;
            }
        }
    }

    throw new Error("Could not extract JSON data from HTML");
}

export function extractThumbnail(htmlStr, jsonData, videoIndex = 0) {
    if (!jsonData) {
        try {
            jsonData = JSON.parse(htmlStr);
        } catch (e) {
            try {
                jsonData = extractJsonFromHtml(htmlStr);
            } catch (e2) {
                // Cannot parse JSON, fallback to regex on string
                const thumbnailPatterns = [
                    /preferred_thumbnail[^}]*image[^}]*uri["']\s*:\s*["']([^"']+)["']/,
                    /thumbnail[^}]*uri["']\s*:\s*["']([^"']+)["']/,
                    /image[^}]*uri["']\s*:\s*["']([^"']+)["']/
                ];
                const strToSearch = typeof htmlStr === 'string' ? htmlStr : JSON.stringify(htmlStr);
                for (const pattern of thumbnailPatterns) {
                    const match = strToSearch.match(pattern);
                    if (match && match[1]) {
                        if (match[1].includes('fbcdn.net') && (match[1].includes('.jpg') || match[1].includes('.png'))) {
                            return match[1];
                        }
                    }
                }
                return null;
            }
        }
    }

    try {
        // Try to find thumbnail from the data structure for the specific video
        if (jsonData.data &&
            jsonData.data.video &&
            jsonData.data.video.story &&
            jsonData.data.video.story.attachments &&
            jsonData.data.video.story.attachments.length > videoIndex) {

            const media = jsonData.data.video.story.attachments[videoIndex].media;
            if (media) {
                if (media.preferred_thumbnail && media.preferred_thumbnail.image && media.preferred_thumbnail.image.uri) {
                    return media.preferred_thumbnail.image.uri;
                }
                if (media.thumbnail_image && media.thumbnail_image.uri) {
                    return media.thumbnail_image.uri;
                }
                if (media.image && media.image.uri) {
                    return media.image.uri;
                }
            }
        }
    } catch (e) {
        console.error("Error extracting thumbnail from data block:", e);
    }

    // Fallback: Check for a thumbnail in the extensions data for the specific video
    try {
        if (jsonData.extensions &&
            jsonData.extensions.all_video_dash_prefetch_representations &&
            jsonData.extensions.all_video_dash_prefetch_representations.length > videoIndex) {
            const videoRepData = jsonData.extensions.all_video_dash_prefetch_representations[videoIndex];
            if (videoRepData.video_thumbnail && videoRepData.video_thumbnail.uri) {
                return videoRepData.video_thumbnail.uri;
            }
        }
    } catch (e) {
        console.error("Error extracting thumbnail from extensions block:", e);
    }


    // Fallback: if no specific thumbnail, use the first one available on the page as a last resort.
    try {
        if (jsonData.data &&
            jsonData.data.video &&
            jsonData.data.video.story &&
            jsonData.data.video.story.attachments &&
            jsonData.data.video.story.attachments.length > 0) {

            const media = jsonData.data.video.story.attachments[0].media;
            if (media && media.preferred_thumbnail && media.preferred_thumbnail.image && media.preferred_thumbnail.image.uri) {
                return media.preferred_thumbnail.image.uri;
            }
        }
    } catch (e) {
        console.error("Error extracting fallback thumbnail:", e);
    }


    return null;
}

// Legacy functions for backward compatibility
export function getIds(resourceStr) {
    const pattern = /"dash_prefetch_experimental":\[\s*"(\d+v)",\s*"(\d+a)"\s*\]/;
    const match = resourceStr.match(pattern);
    if (match) {
        return {
            videoId: match[1],
            audioId: match[2]
        };
    } else {
        throw new Error("No match found");
    }
}

export function extractVideoLinks(htmlStr) {
    let jsonData;
    try {
        jsonData = extractJsonFromHtml(htmlStr);

        if (!jsonData.extensions ||
            !jsonData.extensions.all_video_dash_prefetch_representations ||
            !jsonData.extensions.all_video_dash_prefetch_representations.length === 0) {
            throw new Error("No video representations found in the data");
        }

        const allVideosData = jsonData.extensions.all_video_dash_prefetch_representations;
        const videos = [];

        for (let i = 0; i < allVideosData.length; i++) {
            const videoData = allVideosData[i];
            const representations = videoData.representations;

            if (!representations || representations.length === 0) continue;

            const videoReps = representations.filter(rep => rep.mime_type === "video/mp4");
            const audioReps = representations.filter(rep => rep.mime_type === "audio/mp4");

            if (videoReps.length === 0) continue;

            videoReps.sort((a, b) => a.bandwidth - b.bandwidth);

            const sdVideo = videoReps[0];
            const hdVideo = videoReps[videoReps.length - 1];
            const audioUrl = audioReps.length > 0 ? solveCors(audioReps[0].base_url) : null;
            const thumbnail = extractThumbnail(htmlStr, jsonData, i);

            videos.push({
                videoId: `video_${i}`,
                key: `video_${i}`,
                thumbnail: thumbnail,
                audioUrl: audioUrl,
                resolutions: [{
                    qualityClass: "sd",
                    qualityLabel: "SD",
                    url: solveCors(sdVideo.base_url),
                    key: `video_${i}_sd`
                }, {
                    qualityClass: "hd",
                    qualityLabel: "HD",
                    url: solveCors(hdVideo.base_url),
                    key: `video_${i}_hd`
                }, ]
            });
        }

        if (videos.length > 0) {
            console.log(`Extracted ${videos.length} videos.`);
            return videos;
        }

        throw new Error("No videos found with new method, trying legacy");

    } catch (e) {
        console.warn("New extraction method failed, falling back to legacy method:", e.message);

        // Fallback to legacy method
        let resolutions;
        try {
            const {
                videoId
            } = getIds(htmlStr);
            const cleaner = new Cleaner(htmlStr);
            const cleanedStr = cleaner.clean().value;
            const representationRegex = /<Representation\s+[^>]*id="(\d+v)"[^>]*FBQualityClass="([^"]+)"[^>]*FBQualityLabel="([^"]+)"[^>]*>[\s\S]*?<BaseURL>(https:\/\/[^<]+)<\/BaseURL>/g;
            const reps = [];
            let match;
            while ((match = representationRegex.exec(cleanedStr)) !== null) {
                reps.push({
                    videoId: match[1],
                    qualityClass: match[2],
                    qualityLabel: match[3],
                    url: solveCors(match[4]),
                });
            }
            if (reps.length === 0) throw new Error("No video representations found in legacy method");
            resolutions = reps;
        } catch (err) {
            throw new Error(`Legacy video extraction failed: ${err.message}`);
        }

        const thumbnail = extractThumbnail(htmlStr, null, 0);
        const audioUrl = extractAudioLink(htmlStr);

        return [{
            videoId: 'video_0',
            key: 'video_0',
            thumbnail: thumbnail,
            audioUrl: audioUrl,
            resolutions: resolutions.map((r, i) => ({ ...r,
                key: r.key || `${r.qualityClass}_${r.qualityLabel}_${i}`
            }))
        }];
    }
}


export function extractAudioLink(str) {
    // This function is now only for the legacy path of extractVideoLinks
    try {
        let audioId = null;
        try {
            const ids = getIds(str);
            audioId = ids.audioId;
        } catch (err) {
            return null; // No audio
        }

        const cleaner = new Cleaner(str);
        const cleanedStr = cleaner.clean().value;

        const audioRegex = /<Representation\s+[^>]*id="(\d+a)"[^>]*mimeType="audio\/mp4"[^>]*>[\s\S]*?<BaseURL>(https:\/\/[^<]+)<\/BaseURL>/g;
        let match;
        let audioUrl = null;

        while ((match = audioRegex.exec(cleanedStr)) !== null) {
            if (match[1] === audioId) {
                audioUrl = match[2];
                break;
            }
        }

        if (!audioUrl) return null;

        return solveCors(audioUrl);
    } catch (e) {
        console.warn("Legacy audio extraction failed:", e);
        return null;
    }
}

export function extractTitle(inputString) {
    const pattern = /"story":\s*{"message":\s*{"text":"([^"]+)",/;
    const match = inputString.match(pattern);

    if (match) {
        return match[1];
    } else {
        return "";
    }
}