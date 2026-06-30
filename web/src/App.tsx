/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import {
  acceptGuildInvitation,
  createChannel,
  createGuild,
  createMessage,
  declineGuildInvitation,
  deleteChannel as deleteChannelRequest,
  getMe,
  inviteGuildMember,
  listChannels,
  listGuildInvitations,
  listGuildMembers,
  listGuilds,
  listMessages,
  login,
  register,
  renameChannel,
} from "./api";
import type { Channel, ChannelMember, Guild, GuildInvitation, Message, User } from "./api";
import { VoicePanel } from "./voice/VoicePanel";
import { ScreenShareStage } from "./voice/ScreenShareStage";
import type { VoiceSettings } from "./voice/useVoiceRoom";
import { useVoiceRoom } from "./voice/useVoiceRoom";

type AuthMode = "login" | "register";
type ChannelDraftType = "text" | "voice";
type CreateModalType = "guild" | ChannelDraftType;
type RenameDraft = {
  channelId: string;
  name: string;
} | null;
type VoiceUserMenu = {
  userId: string;
  username: string;
  x: number;
  y: number;
} | null;

type AppSettingsModalProps = {
  voiceSettings: VoiceSettings;
  isConnected: boolean;
  onClose: () => void;
  onToggleMute: () => void;
  onUpdateVoiceSettings: (patch: Partial<VoiceSettings>) => void;
};

const TOKEN_KEY = "kimspeak_token";

function getInitial(value: string) {
  return value.trim().charAt(0).toUpperCase() || "K";
}

function formatTime(value?: string) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getDefaultName(type: CreateModalType) {
  if (type === "guild") {
    return "Kimspeak HQ";
  }

  if (type === "voice") {
    return "Голосовой канал 1";
  }

  return "general";
}

function getRoleLabel(role: ChannelMember["role"]) {
  if (role === "owner") {
    return "Владелец";
  }

  if (role === "admin") {
    return "Админ";
  }

  return "Участник";
}

function AppSettingsModal({
  voiceSettings,
  isConnected,
  onClose,
  onToggleMute,
  onUpdateVoiceSettings,
}: AppSettingsModalProps) {
  return (
    <div
      className="modalBackdrop settingsBackdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="settingsModal" aria-modal="true" role="dialog">
        <header className="settingsHeader">
          <div>
            <h2>Настройки</h2>
            <span>{isConnected ? "Голос активен" : "Голос не подключён"}</span>
          </div>
          <button
            className="settingsClose"
            onClick={onClose}
            type="button"
            title="Закрыть"
          >
            ×
          </button>
        </header>

        <div className="settingsLayout">
          <nav className="settingsNav" aria-label="Разделы настроек">
            <button className="active" type="button">
              Голос
            </button>
          </nav>

          <div className="settingsContent">
            <section className="settingsGroup">
              <div className="settingsGroupHeader">
                <h3>Микрофон</h3>
                <span>{voiceSettings.muted ? "Выключен" : "Включён"}</span>
              </div>

              <button
                className={
                  voiceSettings.muted
                    ? "settingSwitch"
                    : "settingSwitch enabled"
                }
                onClick={onToggleMute}
                type="button"
              >
                <span>Микрофон</span>
                <b>{voiceSettings.muted ? "off" : "on"}</b>
              </button>

              <label className="settingsSlider">
                <span>
                  Громкость микрофона{" "}
                  {Math.round(voiceSettings.inputGain * 100)}%
                </span>
                <input
                  max="2"
                  min="0"
                  onChange={(event) =>
                    onUpdateVoiceSettings({
                      inputGain: Number(event.target.value),
                    })
                  }
                  step="0.05"
                  type="range"
                  value={voiceSettings.inputGain}
                />
              </label>
            </section>

            <section className="settingsGroup">
              <div className="settingsGroupHeader">
                <h3>Обработка</h3>
              </div>

              <div className="settingsToggles">
                <label className="settingsToggle">
                  <input
                    checked={voiceSettings.noiseSuppression}
                    onChange={(event) =>
                      onUpdateVoiceSettings({
                        noiseSuppression: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span>Шумоподавление</span>
                </label>

                <label className="settingsToggle">
                  <input
                    checked={voiceSettings.echoCancellation}
                    onChange={(event) =>
                      onUpdateVoiceSettings({
                        echoCancellation: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span>Подавление эха</span>
                </label>

                <label className="settingsToggle">
                  <input
                    checked={voiceSettings.autoGainControl}
                    onChange={(event) =>
                      onUpdateVoiceSettings({
                        autoGainControl: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span>Автоусиление</span>
                </label>
              </div>
            </section>

            <section className="settingsGroup">
              <div className="settingsGroupHeader">
                <h3>Передача</h3>
                <span>{voiceSettings.bitrateKbps} кбит/с</span>
              </div>

              <label className="settingsSlider">
                <span>Битрейт голоса</span>
                <input
                  max="128"
                  min="16"
                  onChange={(event) =>
                    onUpdateVoiceSettings({
                      bitrateKbps: Number(event.target.value),
                    })
                  }
                  step="8"
                  type="range"
                  value={voiceSettings.bitrateKbps}
                />
              </label>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function App() {
  const voice = useVoiceRoom();

  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_KEY) || "",
  );
  const [user, setUser] = useState<User | null>(null);

  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [guildMembers, setGuildMembers] = useState<ChannelMember[]>([]);
  const [invitations, setInvitations] = useState<GuildInvitation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  const [activeGuildId, setActiveGuildId] = useState("");
  const [activeChannelId, setActiveChannelId] = useState("");

  const [createModalType, setCreateModalType] =
    useState<CreateModalType | null>(null);
  const [createName, setCreateName] = useState("");
  const [renameDraft, setRenameDraft] = useState<RenameDraft>(null);
  const [inviteUsername, setInviteUsername] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [voiceUserMenu, setVoiceUserMenu] = useState<VoiceUserMenu>(null);

  const [status, setStatus] = useState("Готов к работе");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(() => Boolean(token));
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isMembersLoading, setIsMembersLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isInviteSending, setIsInviteSending] = useState(false);
  const [isInvitationUpdating, setIsInvitationUpdating] = useState(false);

  const channelsCacheRef = useRef(new Map<string, Channel[]>());
  const guildMembersCacheRef = useRef(new Map<string, ChannelMember[]>());
  const messagesCacheRef = useRef(new Map<string, Message[]>());

  const activeGuild = useMemo(
    () => guilds.find((guild) => guild.id === activeGuildId) || null,
    [activeGuildId, guilds],
  );

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) || null,
    [activeChannelId, channels],
  );

  const textChannels = useMemo(
    () => channels.filter((channel) => channel.type === "text"),
    [channels],
  );

  const voiceChannels = useMemo(
    () => channels.filter((channel) => channel.type === "voice"),
    [channels],
  );

  const pendingInvitation = invitations[0] || null;
  const createModalTitle =
    createModalType === "guild"
      ? "Создать сервер"
      : createModalType === "voice"
        ? "Создать голосовой канал"
        : "Создать текстовый канал";
  const createModalIcon =
    createModalType === "guild" ? "+" : createModalType === "voice" ? "♪" : "#";
  const createPlaceholder =
    createModalType === "guild"
      ? "Название сервера"
      : createModalType === "voice"
        ? "Название голосового канала"
        : "Название текстового канала";

  const isActiveVoiceChannelJoined =
    activeChannel?.type === "voice" &&
    voice.currentChannelId === activeChannel.id;
  const isActiveVoiceConnecting =
    isActiveVoiceChannelJoined && voice.state === "connecting";
  const voiceUserMenuVolume = voiceUserMenu
    ? voice.remoteVolumes[voiceUserMenu.userId] ?? 1
    : 1;
  const voiceUserMenuStyle = voiceUserMenu
    ? {
        left: Math.max(8, Math.min(voiceUserMenu.x, window.innerWidth - 286)),
        top: Math.max(8, Math.min(voiceUserMenu.y, window.innerHeight - 178)),
      }
    : undefined;

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);

    if (!savedToken) {
      setIsCheckingAuth(false);
      return;
    }

    setStatus("Проверяем авторизацию...");

    getMe(savedToken)
      .then((me) => {
        setToken(savedToken);
        setUser(me);
        setStatus("Авторизация подтверждена");
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
        setUser(null);
        setStatus("Сессия истекла, войдите заново");
      })
      .finally(() => {
        setIsCheckingAuth(false);
      });
  }, []);

  useEffect(() => {
    if (!voiceUserMenu) {
      return;
    }

    const closeMenu = () => setVoiceUserMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [voiceUserMenu]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!token || !user) {
      return;
    }

    setIsWorkspaceLoading(true);
    setError("");

    listGuilds(token)
      .then((items) => {
        setGuilds(items);
        setActiveGuildId((current) => {
          if (current && items.some((guild) => guild.id === current)) {
            return current;
          }

          return items[0]?.id || "";
        });
        setStatus(
          items.length ? "Серверы загружены" : "Создайте первый сервер",
        );
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить серверы",
        );
        setStatus("Ошибка загрузки серверов");
      })
      .finally(() => {
        setIsWorkspaceLoading(false);
      });
  }, [token, user]);

  useEffect(() => {
    if (!token || !user) {
      setInvitations([]);
      return;
    }

    let isCancelled = false;

    const syncInvitations = () => {
      listGuildInvitations(token)
        .then((items) => {
          if (!isCancelled) {
            setInvitations(items);
          }
        })
        .catch(() => {
          if (!isCancelled) {
            setInvitations([]);
          }
        });
    };

    syncInvitations();

    const intervalId = window.setInterval(syncInvitations, 7000);
    window.addEventListener("focus", syncInvitations);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", syncInvitations);
    };
  }, [token, user]);

  useEffect(() => {
    if (!token || !user) {
      return;
    }

    let isCancelled = false;

    const syncGuilds = () => {
      listGuilds(token)
        .then((items) => {
          if (isCancelled) {
            return;
          }

          setGuilds(items);
          setActiveGuildId((current) => {
            if (current && items.some((guild) => guild.id === current)) {
              return current;
            }

            return items[0]?.id || "";
          });
        })
        .catch(() => {
          // Silent sync should not overwrite visible errors from user actions.
        });
    };

    const intervalId = window.setInterval(syncGuilds, 15000);
    window.addEventListener("focus", syncGuilds);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", syncGuilds);
    };
  }, [token, user]);

  useEffect(() => {
    if (!token || !activeGuildId) {
      setChannels([]);
      setActiveChannelId("");
      return;
    }

    let isCancelled = false;
    const cachedChannels = channelsCacheRef.current.get(activeGuildId);

    if (cachedChannels) {
      setChannels(cachedChannels);
      setActiveChannelId((current) => {
        if (cachedChannels.some((channel) => channel.id === current)) {
          return current;
        }

        return (
          cachedChannels.find((channel) => channel.type === "text")?.id ||
          cachedChannels[0]?.id ||
          ""
        );
      });
      setIsWorkspaceLoading(false);
    } else {
      setIsWorkspaceLoading(true);
    }

    setError("");

    listChannels(token, activeGuildId)
      .then((items) => {
        if (isCancelled) {
          return;
        }

        channelsCacheRef.current.set(activeGuildId, items);
        setChannels(items);
        setActiveChannelId((current) => {
          if (items.some((channel) => channel.id === current)) {
            return current;
          }

          return (
            items.find((channel) => channel.type === "text")?.id ||
            items[0]?.id ||
            ""
          );
        });
        setStatus(items.length ? "Каналы загружены" : "Создайте первый канал");

        window.setTimeout(() => {
          if (isCancelled) {
            return;
          }

          for (const channel of items
            .filter((item) => item.type === "text")
            .slice(0, 3)) {
            if (messagesCacheRef.current.has(channel.id)) {
              continue;
            }

            listMessages(token, channel.id)
              .then((messages) => {
                if (!isCancelled) {
                  messagesCacheRef.current.set(channel.id, messages);
                }
              })
              .catch(() => {
                // Background prefetch must stay silent.
              });
          }
        }, 250);
      })
      .catch((err) => {
        if (isCancelled) {
          return;
        }

        if (cachedChannels) {
          return;
        }

        setChannels([]);
        setActiveChannelId("");
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить каналы",
        );
        setStatus("Ошибка загрузки каналов");
      })
      .finally(() => {
        if (!isCancelled) {
          setIsWorkspaceLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [activeGuildId, token]);

  useEffect(() => {
    if (!token || !activeGuildId) {
      setGuildMembers([]);
      setIsMembersLoading(false);
      return;
    }

    let isCancelled = false;
    const cachedMembers = guildMembersCacheRef.current.get(activeGuildId);

    if (cachedMembers) {
      setGuildMembers(cachedMembers);
      setIsMembersLoading(false);
    } else {
      setIsMembersLoading(true);
    }

    listGuildMembers(token, activeGuildId)
      .then((items) => {
        if (!isCancelled) {
          guildMembersCacheRef.current.set(activeGuildId, items);
          setGuildMembers(items);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          if (cachedMembers) {
            return;
          }

          setGuildMembers([]);
          setError(
            err instanceof Error
              ? err.message
              : "Не удалось загрузить участников сервера",
          );
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsMembersLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [activeGuildId, token]);

  useEffect(() => {
    if (!token || !activeChannelId || activeChannel?.type !== "text") {
      setMessages([]);
      return;
    }

    let isCancelled = false;
    const cachedMessages = messagesCacheRef.current.get(activeChannelId);

    if (cachedMessages) {
      setMessages(cachedMessages);
      setIsMessagesLoading(false);
    } else {
      setMessages([]);
      setIsMessagesLoading(true);
    }

    setError("");

    listMessages(token, activeChannelId)
      .then((items) => {
        if (isCancelled) {
          return;
        }

        messagesCacheRef.current.set(activeChannelId, items);
        setMessages(items);
        setStatus("Сообщения загружены");
      })
      .catch((err) => {
        if (isCancelled) {
          return;
        }

        if (cachedMessages) {
          return;
        }

        setMessages([]);
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить сообщения",
        );
        setStatus("Ошибка загрузки сообщений");
      })
      .finally(() => {
        if (!isCancelled) {
          setIsMessagesLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [activeChannel?.type, activeChannelId, token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setIsLoading(true);

    try {
      if (mode === "register") {
        setStatus("Создаём аккаунт...");
        await register(username, email, password);
        setStatus("Аккаунт создан. Теперь можно войти");
        setMode("login");
        return;
      }

      setStatus("Выполняем вход...");

      const response = await login(email, password);
      const receivedToken = response.access_token || response.token;

      if (!receivedToken || !response.user) {
        throw new Error("Backend не вернул пользователя или access_token");
      }

      localStorage.setItem(TOKEN_KEY, receivedToken);
      setToken(receivedToken);
      setUser(response.user);
      setStatus("Вход выполнен успешно");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка";
      setError(message);
      setStatus("Ошибка");
    } finally {
      setIsLoading(false);
    }
  }

  function openCreateModal(type: CreateModalType) {
    setCreateModalType(type);
    setCreateName(getDefaultName(type));
    setRenameDraft(null);
    setError("");
  }

  function closeCreateModal() {
    setCreateModalType(null);
    setCreateName("");
  }

  function openRenameModal(channel: Channel) {
    setRenameDraft({
      channelId: channel.id,
      name: channel.name,
    });
    setCreateModalType(null);
    setError("");
  }

  function closeRenameModal() {
    setRenameDraft(null);
  }

  async function handleCreateFromModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !createModalType || !createName.trim()) {
      return;
    }

    setIsWorkspaceLoading(true);
    setError("");

    try {
      if (createModalType === "guild") {
        const guild = await createGuild(token, createName.trim());
        setGuilds((items) => [guild, ...items]);
        setActiveGuildId(guild.id);
        setStatus("Сервер создан");
        closeCreateModal();
        return;
      }

      if (!activeGuildId) {
        return;
      }

      const channel = await createChannel(
        token,
        activeGuildId,
        createName.trim().replace(/^#/, ""),
        createModalType,
      );
      setChannels((items) => {
        const nextChannels = [...items, channel];
        channelsCacheRef.current.set(activeGuildId, nextChannels);
        return nextChannels;
      });
      setActiveChannelId(channel.id);
      setStatus(
        createModalType === "voice"
          ? "Голосовой канал создан"
          : "Текстовый канал создан",
      );
      closeCreateModal();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось создать объект",
      );
      setStatus("Ошибка создания");
    } finally {
      setIsWorkspaceLoading(false);
    }
  }

  async function handleRenameChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !renameDraft || !renameDraft.name.trim()) {
      return;
    }

    setIsWorkspaceLoading(true);
    setError("");

    try {
      const channel = await renameChannel(
        token,
        renameDraft.channelId,
        renameDraft.name.trim().replace(/^#/, ""),
      );
      setChannels((items) => {
        const nextChannels = items.map((item) =>
          item.id === channel.id ? channel : item,
        );
        if (activeGuildId) {
          channelsCacheRef.current.set(activeGuildId, nextChannels);
        }
        return nextChannels;
      });
      setStatus("Канал переименован");
      closeRenameModal();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Не удалось переименовать канал",
      );
      setStatus("Ошибка переименования");
    } finally {
      setIsWorkspaceLoading(false);
    }
  }

  async function handleDeleteChannel(channelId: string) {
    if (!token) {
      setError("Сначала нужно войти");
      return;
    }

    const confirmed = window.confirm("Удалить канал?");
    if (!confirmed) {
      return;
    }

    setIsWorkspaceLoading(true);
    setError("");

    try {
      await deleteChannelRequest(token, channelId);

      const nextChannels = channels.filter((channel) => channel.id !== channelId);
      if (activeGuildId) {
        channelsCacheRef.current.set(activeGuildId, nextChannels);
      }
      setChannels(nextChannels);

      if (activeChannelId === channelId) {
        setActiveChannelId(
          nextChannels.find((channel) => channel.type === "text")?.id ||
            nextChannels[0]?.id ||
            "",
        );
        setMessages([]);
      }

      setStatus("Канал удалён");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить канал");
      setStatus("Ошибка удаления канала");
    } finally {
      setIsWorkspaceLoading(false);
    }
  }

  function handleJoinVoiceChannel(channel: Channel) {
    setActiveChannelId(channel.id);

    if (!token || !user || voice.currentChannelId === channel.id) {
      return;
    }

    voice.joinVoice({
      authToken: token,
      channelId: channel.id,
      channelName: channel.name,
      guildId: channel.guild_id,
      userId: user.id,
      username: user.username,
    });
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !activeChannelId || !messageDraft.trim()) {
      return;
    }

    setIsSending(true);
    setError("");

    try {
      const message = await createMessage(
        token,
        activeChannelId,
        messageDraft.trim(),
      );
      setMessages((items) => {
        const nextMessages = [...items, message];
        messagesCacheRef.current.set(activeChannelId, nextMessages);
        return nextMessages;
      });
      setMessageDraft("");
      setStatus("Сообщение отправлено");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось отправить сообщение",
      );
      setStatus("Ошибка отправки");
    } finally {
      setIsSending(false);
    }
  }

  async function handleInviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !activeGuild || !inviteUsername.trim()) {
      return;
    }

    setIsInviteSending(true);
    setError("");

    try {
      await inviteGuildMember(token, activeGuild.id, inviteUsername.trim());
      setInviteUsername("");
      setStatus("Приглашение отправлено");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось отправить приглашение",
      );
      setStatus("Ошибка приглашения");
    } finally {
      setIsInviteSending(false);
    }
  }

  async function handleAcceptInvitation(invitationId: string) {
    if (!token) {
      return;
    }

    setIsInvitationUpdating(true);
    setError("");

    try {
      const invitation = await acceptGuildInvitation(token, invitationId);
      setInvitations((items) =>
        items.filter((item) => item.id !== invitationId),
      );

      const items = await listGuilds(token);
      setGuilds(items);
      setActiveGuildId(
        items.some((guild) => guild.id === invitation.guild_id)
          ? invitation.guild_id
          : items[0]?.id || "",
      );
      setStatus(`Вы вступили на сервер ${invitation.guild_name}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось принять приглашение",
      );
      setStatus("Ошибка принятия приглашения");
    } finally {
      setIsInvitationUpdating(false);
    }
  }

  async function handleDeclineInvitation(invitationId: string) {
    if (!token) {
      return;
    }

    setIsInvitationUpdating(true);
    setError("");

    try {
      await declineGuildInvitation(token, invitationId);
      setInvitations((items) =>
        items.filter((item) => item.id !== invitationId),
      );
      setStatus("Приглашение отклонено");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось отклонить приглашение",
      );
      setStatus("Ошибка отклонения приглашения");
    } finally {
      setIsInvitationUpdating(false);
    }
  }

  function logout() {
    voice.leaveVoice();
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
    setGuilds([]);
    setChannels([]);
    setGuildMembers([]);
    setInvitations([]);
    setMessages([]);
    setActiveGuildId("");
    setActiveChannelId("");
    closeCreateModal();
    closeRenameModal();
    setStatus("Вы вышли из аккаунта");
    setError("");
  }

  if (isCheckingAuth) {
    return (
      <div className="loadingPage">
        <div className="loadingCard">
          <div className="brandMark">K</div>
          <h1>kimspeak</h1>
          <p>Проверяем авторизацию...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="authPage">
        <section className="authHero">
          <div className="brandMark">K</div>
          <h1>kimspeak</h1>
          <p>
            Войдите в аккаунт, чтобы открыть серверы, каналы и живую ленту
            сообщений для вашей команды.
          </p>
        </section>

        <section className="authCard">
          <div className="authTitle">
            {mode === "login" ? "Вход" : "Регистрация"}
          </div>

          <div
            className="authTabs"
            role="tablist"
            aria-label="Режим авторизации"
          >
            <button
              className={mode === "login" ? "authTab active" : "authTab"}
              onClick={() => setMode("login")}
              type="button"
            >
              Вход
            </button>
            <button
              className={mode === "register" ? "authTab active" : "authTab"}
              onClick={() => setMode("register")}
              type="button"
            >
              Регистрация
            </button>
          </div>

          <form className="authForm" onSubmit={handleSubmit}>
            {mode === "register" && (
              <label>
                Username
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="k1epa"
                  autoComplete="username"
                />
              </label>
            )}

            <label>
              Email
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="k1epa@example.com"
                type="email"
                autoComplete="email"
              />
            </label>

            <label>
              Password
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                placeholder="123456"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
              />
            </label>

            <button className="submitButton" disabled={isLoading}>
              {isLoading
                ? "Отправляем..."
                : mode === "login"
                  ? "Войти"
                  : "Создать аккаунт"}
            </button>
          </form>

          <div className="statusBox">
            <div>
              <b>Статус:</b> {status}
            </div>
            {error && <div className="errorText">{error}</div>}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="servers" aria-label="Серверы">
        <div className="serverLogo">K</div>

        <div className="serverRail">
          {guilds.map((guild) => (
            <button
              className={
                guild.id === activeGuildId ? "server active" : "server"
              }
              key={guild.id}
              onClick={() => setActiveGuildId(guild.id)}
              title={guild.name}
              type="button"
            >
              {getInitial(guild.name)}
            </button>
          ))}
          <button
            className="server addServer"
            disabled={isWorkspaceLoading}
            onClick={() => openCreateModal("guild")}
            title="Создать сервер"
            type="button"
          >
            +
          </button>
        </div>
      </aside>

      <aside className="channels">
        <div className="guildTitle">
          <div>
            <span>{activeGuild?.name || "Нет сервера"}</span>
            <small>{isWorkspaceLoading ? "Синхронизация..." : status}</small>
          </div>
        </div>

        <div className="channelScroll">
          <div className="channelBlock">
            <div className="channelCategoryRow">
              <div className="channelCategory">Текстовые каналы</div>
              <button
                className="channelActionButton"
                disabled={isWorkspaceLoading || !activeGuild}
                onClick={() => openCreateModal("text")}
                title="Создать текстовый канал"
                type="button"
              >
                +
              </button>
            </div>

            {textChannels.map((channel) => (
              <div className="channelRow" key={channel.id}>
                <button
                  className={
                    channel.id === activeChannelId
                      ? "channel active"
                      : "channel"
                  }
                  onClick={() => setActiveChannelId(channel.id)}
                  type="button"
                >
                  <span className="channelIcon">#</span>
                  <span className="channelName">{channel.name}</span>
                </button>
                <button
                  className="channelEditButton"
                  disabled={isWorkspaceLoading}
                  onClick={() => openRenameModal(channel)}
                  title="Переименовать канал"
                  type="button"
                >
                  ✎
                </button>
                <button
                  className="channelDeleteButton"
                  disabled={isWorkspaceLoading}
                  onClick={() => handleDeleteChannel(channel.id)}
                  title="Удалить канал"
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}

            {!textChannels.length && (
              <div className="emptyHint">Пока нет текстовых каналов</div>
            )}
          </div>

          <div className="channelBlock">
            <div className="channelCategoryRow">
              <div className="channelCategory">Голосовые каналы</div>
              <button
                className="channelActionButton"
                disabled={isWorkspaceLoading || !activeGuild}
                onClick={() => openCreateModal("voice")}
                title="Создать голосовой канал"
                type="button"
              >
                +
              </button>
            </div>

            {voiceChannels.map((channel) => {
              const isCurrentVoiceChannel =
                voice.currentChannelId === channel.id &&
                voice.state !== "error";

              const usersInChannel = isCurrentVoiceChannel
                ? voice.voiceUsers
                : [];

              return (
                <div className="voiceChannelTree" key={channel.id}>
                  <div className="channelRow">
                    <button
                      className={
                        channel.id === activeChannelId || isCurrentVoiceChannel
                          ? "voiceChannelHeader active"
                          : "voiceChannelHeader"
                      }
                      onClick={() => {
                        setActiveChannelId(channel.id);

                        if (!isCurrentVoiceChannel) {
                          handleJoinVoiceChannel(channel);
                        }
                      }}
                      type="button"
                    >
                      <span className="voiceChannelIcon">♪</span>
                      <span className="voiceChannelName">{channel.name}</span>

                      {isCurrentVoiceChannel && (
                        <span className="voiceChannelState">Внутри</span>
                      )}
                    </button>
                    <button
                      className="channelEditButton"
                      disabled={isWorkspaceLoading}
                      onClick={() => openRenameModal(channel)}
                      title="Переименовать канал"
                      type="button"
                    >
                      ✎
                    </button>
                    <button
                      className="channelDeleteButton"
                      disabled={isWorkspaceLoading}
                      onClick={() => handleDeleteChannel(channel.id)}
                      title="Удалить канал"
                      type="button"
                    >
                      ×
                    </button>
                  </div>

                  {usersInChannel.length > 0 && (
                    <div className="voiceChannelMembers">
                      {usersInChannel.map((voiceUser) => {
                        const displayName = voiceUser.username || voiceUser.id;
                        const settings = voiceUser.settings;
                        const isSelf = voiceUser.id === user.id;
                        const localVolume = voice.remoteVolumes[voiceUser.id] ?? 1;
                        const localVolumePercent = Math.round(localVolume * 100);
                        const memberClassName = [
                          "voiceChannelMember",
                          settings?.muted ? "muted" : "",
                          isSelf ? "current" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");

                        return (
                          <div
                            className={memberClassName}
                            key={voiceUser.id}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setVoiceUserMenu(null);

                              if (isSelf) {
                                setIsSettingsOpen(true);
                                return;
                              }

                              setVoiceUserMenu({
                                userId: voiceUser.id,
                                username: displayName,
                                x: event.clientX,
                                y: event.clientY,
                              });
                            }}
                          >
                            <div className="voiceChannelMemberAvatar">
                              {displayName.slice(0, 1).toUpperCase()}
                            </div>

                            <div className="voiceChannelMemberName">
                              {displayName}
                            </div>

                            <div className="voiceChannelMemberIcons">
                              <span
                                className={
                                  settings?.muted
                                    ? "voiceMemberBadge danger"
                                    : "voiceMemberBadge"
                                }
                                title={
                                  settings?.muted
                                    ? "Микрофон выключен"
                                    : "Микрофон включён"
                                }
                              >
                                {settings?.muted ? "off" : "mic"}
                              </span>
                              {!isSelf && localVolumePercent !== 100 && (
                                <span
                                  className="voiceMemberBadge"
                                  title="Локальная громкость"
                                >
                                  {localVolumePercent}%
                                </span>
                              )}
                              {settings?.noiseSuppression && (
                                <span
                                  className="voiceMemberBadge"
                                  title="Шумоподавление"
                                >
                                  NS
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {!voiceChannels.length && (
              <div className="emptyHint emptyHintWithAction">
                <span>Пока нет голосовых каналов</span>
                <button
                  className="emptyActionButton"
                  disabled={isWorkspaceLoading || !activeGuild}
                  onClick={() => openCreateModal("voice")}
                  type="button"
                >
                  Создать голосовой
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="profilePanel">
          <div className="profileAvatar">{getInitial(user.username)}</div>
          <div className="profileInfo">
            <div className="profileName">{user.username}</div>
            <div className="profileStatus online">online</div>
          </div>
          <button
            className="profileSettings"
            onClick={() => setIsSettingsOpen(true)}
            title="Настройки"
            type="button"
          >
            ⚙
          </button>
          <button
            className="profileLogout"
            onClick={logout}
            title="Выйти"
            type="button"
          >
            ⏻
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <strong>
              {activeChannel?.type === "voice" ? "♪" : "#"}{" "}
              {activeChannel?.name || "канал не выбран"}
            </strong>
            <span>
              {activeGuild
                ? `Сервер ${activeGuild.name}`
                : "Создайте сервер, чтобы начать общение"}
            </span>
          </div>
        </header>

        <section className="chat">
          {!activeGuild && (
            <div className="emptyState">
              <h2>Создайте первый сервер</h2>
              <p>После этого можно будет добавить каналы и начать переписку.</p>
            </div>
          )}

          {activeGuild && !activeChannel && (
            <div className="emptyState">
              <h2>Добавьте канал</h2>
              <p>
                Текстовый канал нужен для сообщений, голосовой можно оставить
                как комнату.
              </p>
            </div>
          )}

          {activeChannel?.type === "voice" && (
            <div className="voiceRoom">
              <div className="pulse">♪</div>
              <h2>{activeChannel.name}</h2>
              <p>
                Голосовая комната готова. Текстовые сообщения доступны в каналах
                с #.
              </p>
              <button
                className="voiceRoomJoinButton"
                disabled={isActiveVoiceChannelJoined && voice.state !== "error"}
                onClick={() => handleJoinVoiceChannel(activeChannel)}
                type="button"
              >
                {isActiveVoiceConnecting
                  ? "Подключаемся..."
                  : isActiveVoiceChannelJoined && voice.state !== "error"
                    ? "Вы в канале"
                    : "Войти в голос"}
              </button>
            </div>
          )}

          {activeChannel?.type === "voice" && isActiveVoiceChannelJoined && (
            <ScreenShareStage
              isLocalSharing={voice.isScreenSharing}
              screenShares={voice.screenShares}
              onStopLocalShare={voice.stopScreenShare}
            />
          )}

          {activeChannel?.type === "text" && isMessagesLoading && (
            <div className="emptyHint">Загружаем сообщения...</div>
          )}

          {activeChannel?.type === "text" &&
            !isMessagesLoading &&
            !messages.length && (
              <div className="emptyState">
                <h2>Тут пока тихо</h2>
                <p>Напишите первое сообщение в #{activeChannel.name}.</p>
              </div>
            )}

          {activeChannel?.type === "text" &&
            messages.map((message) => {
              const isOwn = message.author_id === user.id;
              const authorName = isOwn
                ? user.username
                : `user-${message.author_id.slice(0, 6)}`;

              return (
                <article
                  className={isOwn ? "message ownMessage" : "message"}
                  key={message.id}
                >
                  <div className="avatar">{getInitial(authorName)}</div>
                  <div className="messageBody">
                    <div className="messageMeta">
                      <span className="author">{authorName}</span>
                      <time>{formatTime(message.created_at)}</time>
                    </div>
                    <p>{message.content}</p>
                  </div>
                </article>
              );
            })}
        </section>

        {error && <div className="inlineError">{error}</div>}

        <form className="messageInput" onSubmit={handleSendMessage}>
          <input
            disabled={
              !activeChannel || activeChannel.type !== "text" || isSending
            }
            value={messageDraft}
            onChange={(event) => setMessageDraft(event.target.value)}
            placeholder={
              activeChannel?.type === "text"
                ? `Написать сообщение в #${activeChannel.name}`
                : "Выберите текстовый канал"
            }
          />
          <button
            disabled={
              !activeChannel ||
              activeChannel.type !== "text" ||
              !messageDraft.trim() ||
              isSending
            }
          >
            Отправить
          </button>
        </form>
      </main>

      <aside className="members">
        <div className="accountPanel">
          <div className="bigAvatar">{getInitial(user.username)}</div>
          <div className="accountName">{user.username}</div>
          <div className="accountEmail">{user.email}</div>
        </div>

        {activeGuild && (
          <div className="membersPanel">
            <div className="membersTitle">Пригласить в сервер</div>
            <form className="inviteForm" onSubmit={handleInviteMember}>
              <input
                disabled={isInviteSending}
                value={inviteUsername}
                onChange={(event) => setInviteUsername(event.target.value)}
                placeholder="Никнейм"
                autoComplete="off"
              />
              <button
                disabled={isInviteSending || !inviteUsername.trim()}
                type="submit"
              >
                {isInviteSending ? "Отправляем..." : "Пригласить"}
              </button>
            </form>
          </div>
        )}

        <div className="membersPanel">
          <div className="membersTitle">
            Пользователи сервера <span>{guildMembers.length}</span>
          </div>

          {!activeGuild && <div className="emptyHint">Выберите сервер</div>}

          {activeGuild && isMembersLoading && (
            <div className="emptyHint">Загружаем участников...</div>
          )}

          {activeGuild && !isMembersLoading && !guildMembers.length && (
            <div className="emptyHint">Пока нет участников</div>
          )}

          {activeGuild &&
            !isMembersLoading &&
            guildMembers.map((member) => (
              <div
                className={
                  member.id === user.id ? "member current" : "member"
                }
                key={member.id}
              >
                <div className="memberAvatar">
                  {getInitial(member.username)}
                </div>
                <div className="memberInfo">
                  <div className="memberName">{member.username}</div>
                </div>
                <span className={`memberRole ${member.role}`}>
                  {getRoleLabel(member.role)}
                </span>
              </div>
            ))}
        </div>

        <div className="membersPanel">
          <div className="membersTitle">Сводка</div>
          <div className="statRow">
            <span>Серверы</span>
            <b>{guilds.length}</b>
          </div>
          <div className="statRow">
            <span>Каналы</span>
            <b>{channels.length}</b>
          </div>
          <div className="statRow">
            <span>Пользователи</span>
            <b>{activeGuild ? guildMembers.length : 0}</b>
          </div>
        </div>
      </aside>

      {pendingInvitation && (
        <div className="inviteToast" role="status">
          <div className="inviteToastBody">
            <strong>Приглашение на сервер</strong>
            <span>
              {pendingInvitation.inviter_username} приглашает в{" "}
              {pendingInvitation.guild_name}
            </span>
            {invitations.length > 1 && (
              <small>Ещё приглашений: {invitations.length - 1}</small>
            )}
          </div>
          <div className="inviteToastActions">
            <button
              disabled={isInvitationUpdating}
              onClick={() => handleDeclineInvitation(pendingInvitation.id)}
              type="button"
            >
              Отклонить
            </button>
            <button
              disabled={isInvitationUpdating}
              onClick={() => handleAcceptInvitation(pendingInvitation.id)}
              type="button"
            >
              Принять
            </button>
          </div>
        </div>
      )}

      {createModalType && (
        <div className="modalBackdrop">
          <section className="createModal" aria-modal="true" role="dialog">
            <div className="createModalHeader">
              <div className="createModalIcon">{createModalIcon}</div>
              <div>
                <h2>{createModalTitle}</h2>
              </div>
            </div>

            <form className="createModalForm" onSubmit={handleCreateFromModal}>
              <input
                autoFocus
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder={createPlaceholder}
              />

              <div className="createModalActions">
                <button
                  className="createModalSecondary"
                  disabled={isWorkspaceLoading}
                  onClick={closeCreateModal}
                  type="button"
                >
                  Отмена
                </button>
                <button
                  className="createModalPrimary"
                  disabled={isWorkspaceLoading || !createName.trim()}
                  type="submit"
                >
                  Создать
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {renameDraft && (
        <div className="modalBackdrop">
          <section className="createModal" aria-modal="true" role="dialog">
            <div className="createModalHeader">
              <div className="createModalIcon">✎</div>
              <div>
                <h2>Переименовать канал</h2>
              </div>
            </div>

            <form className="createModalForm" onSubmit={handleRenameChannel}>
              <input
                autoFocus
                value={renameDraft.name}
                onChange={(event) =>
                  setRenameDraft((draft) =>
                    draft
                      ? {
                          ...draft,
                          name: event.target.value,
                        }
                      : draft,
                  )
                }
                placeholder="Название канала"
              />

              <div className="createModalActions">
                <button
                  className="createModalSecondary"
                  disabled={isWorkspaceLoading}
                  onClick={closeRenameModal}
                  type="button"
                >
                  Отмена
                </button>
                <button
                  className="createModalPrimary"
                  disabled={isWorkspaceLoading || !renameDraft.name.trim()}
                  type="submit"
                >
                  Сохранить
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {isSettingsOpen && (
        <AppSettingsModal
          voiceSettings={voice.voiceSettings}
          isConnected={voice.state === "connected"}
          onClose={() => setIsSettingsOpen(false)}
          onToggleMute={voice.toggleMute}
          onUpdateVoiceSettings={voice.updateVoiceSettings}
        />
      )}

      {voiceUserMenu && (
        <div
          className="voiceUserMenu"
          style={voiceUserMenuStyle}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="voiceUserMenuTitle">
            <span>{voiceUserMenu.username}</span>
            <b>{Math.round(voiceUserMenuVolume * 100)}%</b>
          </div>

          <label className="voiceUserMenuSlider">
            <span>Громкость</span>
            <input
              max="2"
              min="0"
              onChange={(event) =>
                voice.updateRemoteVolume(
                  voiceUserMenu.userId,
                  Number(event.target.value),
                )
              }
              step="0.05"
              type="range"
              value={voiceUserMenuVolume}
            />
          </label>

          <button
            className="voiceUserMenuReset"
            onClick={() => voice.updateRemoteVolume(voiceUserMenu.userId, 1)}
            type="button"
          >
            Сбросить на 100%
          </button>
        </div>
      )}

      <VoicePanel
        state={voice.state}
        error={voice.error}
        muted={voice.muted}
        voiceSettings={voice.voiceSettings}
        channelName={voice.currentChannelName}
        remoteStreams={voice.remoteStreams}
        remoteVolumes={voice.remoteVolumes}
        isScreenSharing={voice.isScreenSharing}
        onToggleMute={voice.toggleMute}
        onToggleScreenShare={voice.toggleScreenShare}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLeave={voice.leaveVoice}
      />
    </div>
  );
}

export default App;
