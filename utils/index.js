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

export function extractMediaUrls(htmlStr) {
    let jsonData;

    jsonData = extractJsonFromHtml(htmlStr);

    if (!jsonData.extensions ||
        !jsonData.extensions.all_video_dash_prefetch_representations ||
        jsonData.extensions.all_video_dash_prefetch_representations.length === 0) {
        throw new Error("No video representations found in the data");
    }

    const representations = jsonData.extensions.all_video_dash_prefetch_representations[0].representations;

    if (!representations || representations.length === 0) {
        throw new Error("No representations found");
    }

    // Separate video and audio representations
    const videoReps = representations.filter(rep => rep.mime_type === "video/mp4");
    const audioReps = representations.filter(rep => rep.mime_type === "audio/mp4");

    if (videoReps.length === 0) {
        throw new Error("No video representations found");
    }

    // Sort video representations by bandwidth
    videoReps.sort((a, b) => a.bandwidth - b.bandwidth);

    // Get SD (lowest bandwidth) and HD (highest bandwidth)
    const sdVideo = videoReps[0];
    const hdVideo = videoReps[videoReps.length - 1];

    // If no audio, set audioUrl to null
    const audioUrl = audioReps.length > 0 ? solveCors(audioReps[0].base_url) : null;

    const result = [
        {
            type: "sd",
            videoUrl: solveCors(sdVideo.base_url),
            audioUrl: audioUrl
        },
        {
            type: "hd",
            videoUrl: solveCors(hdVideo.base_url),
            audioUrl: audioUrl
        }
    ];

    console.log("Extracted media URLs:", result);
    return result;
}

export function extractThumbnail(htmlStr) {
    let jsonData;
    
    try {
        // First try to parse as direct JSON
        jsonData = JSON.parse(htmlStr);
    } catch (e) {
        // If not direct JSON, try to extract from HTML
        jsonData = extractJsonFromHtml(htmlStr);
    }

    // Try to find thumbnail from the data structure
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

    // Fallback: try to find any video thumbnail in the JSON
    const thumbnailPatterns = [
        /preferred_thumbnail[^}]*image[^}]*uri["']\s*:\s*["']([^"']+)["']/,
        /thumbnail[^}]*uri["']\s*:\s*["']([^"']+)["']/,
        /image[^}]*uri["']\s*:\s*["']([^"']+)["']/
    ];

    const jsonStr = typeof htmlStr === 'string' ? htmlStr : JSON.stringify(jsonData);
    
    for (const pattern of thumbnailPatterns) {
        const match = jsonStr.match(pattern);
        if (match && match[1]) {
            // Make sure it's a valid image URL
            if (match[1].includes('fbcdn.net') && (match[1].includes('.jpg') || match[1].includes('.png'))) {
                return match[1];
            }
        }
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

export function extractVideoLinks(str) {
    try {
        // Try new method first
        const mediaUrls = extractMediaUrls(str);
        return mediaUrls.map((media, index) => ({
            videoId: `${media.type}_${index}`,
            qualityClass: media.type,
            url: media.videoUrl,
            key: `${media.type}_${index}`
        }));
    } catch (e) {
        console.warn("New extraction method failed, falling back to legacy method:", e);

        // Fallback to legacy method
        const { videoId } = getIds(str);
        console.log("videoId:", videoId);

        // Clean the entire input string
        const cleaner = new Cleaner(str);
        const cleanedStr = cleaner.clean().value;

        // Regex to match Representation blocks
        const representationRegex = /<Representation\s+[^>]*id="(\d+v)"[^>]*FBQualityClass="([^"]+)"[^>]*FBQualityLabel="([^"]+)"[^>]*>[\s\S]*?<BaseURL>(https:\/\/[^<]+)<\/BaseURL>/g;
        const representations = [];
        let match;

        // Collect all representation matches
        while ((match = representationRegex.exec(cleanedStr)) !== null) {
            console.log("Match found:", match);
            console.log("Video ID in match:", match[1]);
            representations.push({
                videoId: match[1],
                qualityClass: match[2],
                qualityLabel: match[3],
                url: solveCors(match[4]),
                key: `${match[2]}_${match[3]}_${representations.length}`
            });
        }

        if (representations.length === 0) {
            throw new Error("No video representations found");
        }

        console.log("result:", representations);
        return representations;
    }
}

export function extractAudioLink(str) {
    try {
        // Try new method first
        const mediaUrls = extractMediaUrls(str);
        // If audioUrl is missing or null, return null
        if (!mediaUrls[0].audioUrl) return null;
        return mediaUrls[0].audioUrl; // Both SD and HD use the same audio URL
    } catch (e) {
        console.warn("New extraction method failed, falling back to legacy method:", e);

        // Fallback to legacy method
        let audioId = null;
        try {
            const ids = getIds(str);
            audioId = ids.audioId;
        } catch (err) {
            // If no audioId found, return null (no audio in content)
            return null;
        }
        console.log("audioId:", audioId);

        // Clean the entire input string
        const cleaner = new Cleaner(str);
        const cleanedStr = cleaner.clean().value;

        // Regex to match audio Representation blocks
        const audioRegex = /<Representation\s+[^>]*id="(\d+a)"[^>]*mimeType="audio\/mp4"[^>]*>[\s\S]*?<BaseURL>(https:\/\/[^<]+)<\/BaseURL>/g;
        let match;
        let audioUrl = null;

        // Find the audio representation matching the audioId
        while ((match = audioRegex.exec(cleanedStr)) !== null) {
            if (match[1] === audioId) {
                audioUrl = match[2];
                break;
            }
        }

        // If no audioUrl found, return null (no audio in content)
        if (!audioUrl) {
            return null;
        }

        return solveCors(audioUrl);
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