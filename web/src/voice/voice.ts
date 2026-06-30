export type VoiceTokenResponse = {
    url: string;
    token: string;
    room: string;
};

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";


export async function createVoiceToken(params: {
    accessToken: string;
    guildId: string;
    channelId: string;
}): Promise<VoiceTokenResponse> {
    const response = await fetch(`${API_URL}/voice/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${params.accessToken}`,
        },
        body: JSON.stringify({
            guild_id: params.guildId,
            channel_id: params.channelId,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Не удалось получить LiveKit token: ${text}`);
    }

    return response.json();
}