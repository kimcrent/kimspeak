const API_BASE_URL = "/api";

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

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const data = text && contentType.includes("application/json") ? JSON.parse(text) : text;

  if (!response.ok) {
    const message =
      typeof data === "object" && data && "error" in data
        ? String(data.error)
        : text || `Ошибка запроса: ${response.status}`;

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

export async function listMessages(token: string, channelId: string): Promise<Message[]> {
  const data = await request<{ messages: Message[] }>(
    `/channels/${channelId}/messages?limit=80`,
    { method: "GET" },
    token,
  );

  return data.messages || [];
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
