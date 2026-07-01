import { invoke } from "@tauri-apps/api/core";

const API_BASE_URL = normalizeBaseUrl(
  import.meta.env.DEV ? "/api" : import.meta.env.VITE_API_BASE_URL,
);



type TauriApiResponse = {
  ok: boolean;
  status: number;
  text: string;
  contentType?: string | null;
};

export type VoiceTokenResponse = {
  url: string;
  token: string;
  room: string;
};

function normalizeBaseUrl(baseUrl?: string): string {
  const normalized = baseUrl?.trim() || "/api";
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function getJsonBody(body: BodyInit | null | undefined): unknown {
  if (!body) {
    return null;
  }

  if (typeof body !== "string") {
    throw new Error("Tauri API bridge поддерживает только JSON body");
  }

  return JSON.parse(body);
}

export type User = {
  id: string;
  username: string;
  email: string;
  created_at?: string;
  updated_at?: string;
};

export type Guild = {
  id: string;
  name: string;
  owner_id: string;
  created_at?: string;
  updated_at?: string;
};

export type Channel = {
  id: string;
  guild_id: string;
  name: string;
  type: "text" | "voice";
  position: number;
  created_at?: string;
  updated_at?: string;
};

export type Message = {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  created_at?: string;
  updated_at?: string;
};

export type ChannelMember = {
  id: string;
  username: string;
  role: "owner" | "admin" | "member";
};

export type GuildInvitation = {
  id: string;
  guild_id: string;
  guild_name: string;
  inviter_id: string;
  inviter_username: string;
  status: "pending" | "accepted" | "declined";
  created_at?: string;
};

export type AuthResponse = {
  token?: string;
  access_token?: string;
  user?: User;
  error?: string;
};

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.headers) {
    new Headers(options.headers).forEach((value, key) => {
      headers[key] = value;
    });
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let ok: boolean;
  let status: number;
  let text: string;
  let contentType: string;

  if (!import.meta.env.DEV && isTauriRuntime()) {
    try {
      const response = await invoke<TauriApiResponse>("api_request", {
        request: {
          baseUrl: API_BASE_URL,
          path,
          method: options.method || "GET",
          headers,
          body: getJsonBody(options.body),
        },
      });

      ok = response.ok;
      status = response.status;
      text = response.text;
      contentType = response.contentType || "";
    } catch (err) {
      const message = err instanceof Error ? err.message : "сетевой сбой";
      throw new Error(
        `Не удалось подключиться к API (${API_BASE_URL}): ${message}`,
        { cause: err },
      );
    }
  } else {
    const url = `${API_BASE_URL}${path}`;
    let response: Response;

    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "сетевой сбой";
      throw new Error(
        `Не удалось подключиться к API (${API_BASE_URL}): ${message}`,
        { cause: err },
      );
    }

    ok = response.ok;
    status = response.status;
    text = await response.text();
    contentType = response.headers.get("content-type") || "";
  }

  const data = text && contentType.includes("application/json") ? JSON.parse(text) : text;

  if (!ok) {
    const message =
      typeof data === "object" && data && "error" in data
        ? String(data.error)
        : text || `Ошибка запроса: ${status}`;

    throw new Error(message);
  }

  return data as T;
}

export async function register(
  username: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      email,
      password,
    }),
  });
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
    }),
  });
}

export async function getMe(token: string): Promise<User> {
  const data = await request<User | { user: User }>("/me", { method: "GET" }, token);

  if ("user" in data) {
    return data.user;
  }

  return data;
}

export async function listGuilds(token: string): Promise<Guild[]> {
  const data = await request<{ guilds: Guild[] }>("/guilds", { method: "GET" }, token);
  return data.guilds || [];
}

export async function createGuild(token: string, name: string): Promise<Guild> {
  const data = await request<{ guilds?: Guild; guild?: Guild }>(
    "/guilds",
    {
      method: "POST",
      body: JSON.stringify({ name }),
    },
    token,
  );

  const guild = data.guild || data.guilds;

  if (!guild) {
    throw new Error("Backend не вернул созданный сервер");
  }

  return guild;
}

export async function inviteGuildMember(
  token: string,
  guildId: string,
  username: string,
): Promise<GuildInvitation> {
  const data = await request<{ invitation: GuildInvitation }>(
    `/guilds/${guildId}/members`,
    {
      method: "POST",
      body: JSON.stringify({ username }),
    },
    token,
  );

  return data.invitation;
}

export async function listGuildInvitations(
  token: string,
): Promise<GuildInvitation[]> {
  const data = await request<{ invitations: GuildInvitation[] }>(
    "/guild-invitations",
    { method: "GET" },
    token,
  );

  return data.invitations || [];
}

export async function acceptGuildInvitation(
  token: string,
  invitationId: string,
): Promise<GuildInvitation> {
  const data = await request<{ invitation: GuildInvitation }>(
    `/guild-invitations/${invitationId}/accept`,
    { method: "POST" },
    token,
  );

  return data.invitation;
}

export async function declineGuildInvitation(
  token: string,
  invitationId: string,
): Promise<GuildInvitation> {
  const data = await request<{ invitation: GuildInvitation }>(
    `/guild-invitations/${invitationId}/decline`,
    { method: "POST" },
    token,
  );

  return data.invitation;
}

export async function listChannels(token: string, guildId: string): Promise<Channel[]> {
  const data = await request<{ channels: Channel[] }>(
    `/channels?guild_id=${encodeURIComponent(guildId)}`,
    { method: "GET" },
    token,
  );

  return data.channels || [];
}

export async function createChannel(
  token: string,
  guildId: string,
  name: string,
  type: Channel["type"],
): Promise<Channel> {
  const data = await request<{ channel: Channel }>(
    "/channels",
    {
      method: "POST",
      body: JSON.stringify({
        guild_id: guildId,
        name,
        type,
      }),
    },
    token,
  );

  return data.channel;
}

export async function deleteChannel(token: string, channelId: string): Promise<void> {
  await request<void>(
    `/channels?id=${encodeURIComponent(channelId)}`,
    { method: "DELETE" },
    token,
  );
}

export async function renameChannel(
  token: string,
  channelId: string,
  name: string,
): Promise<Channel> {
  const data = await request<{ channel: Channel }>(
    `/channels?id=${encodeURIComponent(channelId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name }),
    },
    token,
  );

  return data.channel;
}

export async function listGuildMembers(
  token: string,
  guildId: string,
): Promise<ChannelMember[]> {
  const data = await request<{ members: ChannelMember[] }>(
    `/guilds/${guildId}/members`,
    { method: "GET" },
    token,
  );

  return data.members || [];
}

export async function listChannelMembers(
  token: string,
  channelId: string,
): Promise<ChannelMember[]> {
  const data = await request<{ members: ChannelMember[] }>(
    `/channels/${channelId}/members`,
    { method: "GET" },
    token,
  );

  return data.members || [];
}

export async function listMessages(token: string, channelId: string): Promise<Message[]> {
  const data = await request<{ messages: Message[] }>(
    `/channels/${channelId}/messages?limit=80`,
    { method: "GET" },
    token,
  );

  return data.messages || [];
}

export type VoiceClientType = "app" | "screen";

export async function createVoiceToken(
  token: string,
  guildId: string,
  channelId: string,
  client: VoiceClientType = "app",
): Promise<VoiceTokenResponse> {
  return request<VoiceTokenResponse>(
    "/voice/token",
    {
      method: "POST",
      body: JSON.stringify({
        guild_id: guildId,
        channel_id: channelId,
        client,
      }),
    },
    token,
  );
}

export async function createMessage(
  token: string,
  channelId: string,
  content: string,
): Promise<Message> {
  return request<Message>(
    `/channels/${channelId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
    token,
  );
}
