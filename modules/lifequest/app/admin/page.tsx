"use client";

import { FormEvent, useEffect, useState } from "react";
import AppHeader from "@lifequest/components/AppHeader";
import { apiFetch } from "@lifequest/lib/api";

type AdminUser = {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
  createdAt: string;
  _count?: {
    missions: number;
    attributes: number;
    pushSubscriptions: number;
  };
};

type AdminAttribute = {
  id: string;
  userId: string;
  characterId: string;
  name: string;
  value: number;
  icon?: string | null;
  color?: string | null;
  user: {
    id: string;
    email: string;
  };
  character: {
    id: string;
    name: string;
  };
  _count?: {
    missions: number;
  };
};

type AdminSubscription = {
  id: string;
  endpoint: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
  };
};

type PushTemplate = {
  id: string;
  type: "EVENT_START" | "MISSION_DAILY";
  title: string;
  body: string;
};

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [attributes, setAttributes] = useState<AdminAttribute[]>([]);
  const [subscriptions, setSubscriptions] = useState<AdminSubscription[]>([]);
  const [templates, setTemplates] = useState<PushTemplate[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"USER" | "ADMIN">("USER");

  const [attributeUserId, setAttributeUserId] = useState("");
  const [attributeName, setAttributeName] = useState("");
  const [attributeValue, setAttributeValue] = useState(0);
  const [attributeIcon, setAttributeIcon] = useState("");
  const [attributeColor, setAttributeColor] = useState("");

  const [testUserId, setTestUserId] = useState("");
  const [testTitle, setTestTitle] = useState("LifeQuest test notification");
  const [testBody, setTestBody] = useState("Bạn còn mission cần kiểm tra hôm nay.");

  async function loadAdminData() {
    setError("");

    try {
      const [userData, attributeData, notificationData, templateData] = await Promise.all([
        apiFetch<{ users: AdminUser[] }>("/api/admin/users"),
        apiFetch<{ attributes: AdminAttribute[] }>("/api/admin/attributes"),
        apiFetch<{ subscriptions: AdminSubscription[] }>("/api/admin/notifications"),
        apiFetch<{ templates: PushTemplate[] }>("/api/admin/notifications/templates"),
      ]);

      setUsers(userData.users);
      setAttributes(attributeData.attributes);
      setSubscriptions(notificationData.subscriptions);
      setTemplates(templateData.templates);

      if (!attributeUserId && userData.users.length > 0) {
        setAttributeUserId(userData.users[0].id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Cannot load admin data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let ignore = false;

    Promise.all([
      apiFetch<{ users: AdminUser[] }>("/api/admin/users"),
      apiFetch<{ attributes: AdminAttribute[] }>("/api/admin/attributes"),
      apiFetch<{ subscriptions: AdminSubscription[] }>("/api/admin/notifications"),
      apiFetch<{ templates: PushTemplate[] }>("/api/admin/notifications/templates"),
    ])
      .then(([userData, attributeData, notificationData, templateData]) => {
        if (ignore) return;

        setUsers(userData.users);
        setAttributes(attributeData.attributes);
        setSubscriptions(notificationData.subscriptions);
        setTemplates(templateData.templates);

        if (userData.users.length > 0) {
          setAttributeUserId(userData.users[0].id);
        }
      })
      .catch((loadError) => {
        if (ignore) return;

        setError(loadError instanceof Error ? loadError.message : "Cannot load admin data.");
      })
      .finally(() => {
        if (ignore) return;

        setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole,
        }),
      });
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("USER");
      setMessage("User created.");
      await loadAdminData();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Cannot create user.");
    }
  }

  async function updateUser(user: AdminUser) {
    const email = window.prompt("Email", user.email);
    if (!email) return;
    const role = window.prompt("Role: USER hoặc ADMIN", user.role);
    if (role !== "USER" && role !== "ADMIN") return;
    const password = window.prompt("New password, bỏ trống nếu không đổi", "");

    try {
      await apiFetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          email,
          role,
          password: password || undefined,
        }),
      });
      setMessage("User updated.");
      await loadAdminData();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Cannot update user.");
    }
  }

  async function deleteUser(user: AdminUser) {
    if (!window.confirm(`Delete user ${user.email}?`)) return;

    try {
      await apiFetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });
      setMessage("User deleted.");
      await loadAdminData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Cannot delete user.");
    }
  }

  async function createAttribute(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      await apiFetch("/api/admin/attributes", {
        method: "POST",
        body: JSON.stringify({
          userId: attributeUserId,
          name: attributeName,
          value: attributeValue,
          icon: attributeIcon || null,
          color: attributeColor || null,
        }),
      });
      setAttributeName("");
      setAttributeValue(0);
      setAttributeIcon("");
      setAttributeColor("");
      setMessage("Attribute created.");
      await loadAdminData();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Cannot create attribute.");
    }
  }

  async function updateAttribute(attribute: AdminAttribute) {
    const name = window.prompt("Attribute name", attribute.name);
    if (!name) return;
    const value = Number(window.prompt("Value", String(attribute.value)));

    try {
      await apiFetch(`/api/admin/attributes/${attribute.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          value: Number.isNaN(value) ? attribute.value : value,
        }),
      });
      setMessage("Attribute updated.");
      await loadAdminData();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Cannot update attribute.");
    }
  }

  async function deleteAttribute(attribute: AdminAttribute) {
    if (!window.confirm(`Delete attribute ${attribute.name}?`)) return;

    try {
      await apiFetch(`/api/admin/attributes/${attribute.id}`, {
        method: "DELETE",
      });
      setMessage("Attribute deleted.");
      await loadAdminData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Cannot delete attribute.");
    }
  }

  async function deleteSubscription(subscription: AdminSubscription) {
    if (!window.confirm(`Delete subscription for ${subscription.user.email}?`)) return;

    try {
      await apiFetch(`/api/admin/notifications/${subscription.id}`, {
        method: "DELETE",
      });
      setMessage("Subscription deleted.");
      await loadAdminData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Cannot delete subscription.");
    }
  }

  async function sendTestNotification(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      const result = await apiFetch<{ sent: number; failed: number; subscriptions: number }>(
        "/api/admin/notifications/test",
        {
          method: "POST",
          body: JSON.stringify({
            userId: testUserId || null,
            title: testTitle,
            body: testBody,
            url: "/lifequest/dashboard",
          }),
        }
      );
      setMessage(
        `Test notification sent: ${result.sent}/${result.subscriptions}, failed ${result.failed}.`
      );
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Cannot send test notification.");
    }
  }

  async function updateTemplate(template: PushTemplate) {
    const title = window.prompt("Notification title template", template.title);
    if (!title) return;
    const body = window.prompt("Notification body template", template.body);
    if (!body) return;

    try {
      await apiFetch("/api/admin/notifications/templates", {
        method: "PATCH",
        body: JSON.stringify({
          type: template.type,
          title,
          body,
        }),
      });
      setMessage("Notification template updated.");
      await loadAdminData();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Cannot update template.");
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppHeader title="Admin" subtitle="Quản lý users, attributes và notifications." />

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">
            {error}
          </div>
        )}

        {message && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-300">
            {message}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <span className="lifequest-spinner" /> Loading admin data...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-xl font-bold">Users</h2>
              <form onSubmit={createUser} className="mt-4 space-y-3">
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="email" value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} required />
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="password" value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} required />
                <select className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" value={newUserRole} onChange={(event) => setNewUserRole(event.target.value as "USER" | "ADMIN")}>
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
                <button className="w-full rounded-xl bg-indigo-500 py-3 font-medium hover:bg-indigo-400">Create user</button>
              </form>
              <div className="mt-5 space-y-3">
                {users.map((user) => (
                  <div key={user.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="font-semibold">{user.email}</div>
                    <div className="text-sm text-slate-400">{user.role} · {user._count?.missions ?? 0} missions · {user._count?.pushSubscriptions ?? 0} pushes</div>
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => updateUser(user)} className="rounded-lg border border-slate-700 bg-white px-3 py-2 text-sm hover:bg-slate-800">Edit</button>
                      <button onClick={() => deleteUser(user)} className="rounded-lg border border-red-500/30 bg-white px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-xl font-bold">Attributes</h2>
              <form onSubmit={createAttribute} className="mt-4 space-y-3">
                <select className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" value={attributeUserId} onChange={(event) => setAttributeUserId(event.target.value)} required>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.email}</option>
                  ))}
                </select>
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="name" value={attributeName} onChange={(event) => setAttributeName(event.target.value)} required />
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" type="number" min="0" value={attributeValue} onChange={(event) => setAttributeValue(Number(event.target.value))} />
                <div className="grid grid-cols-2 gap-3">
                  <input className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="icon" value={attributeIcon} onChange={(event) => setAttributeIcon(event.target.value)} />
                  <input className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="color" value={attributeColor} onChange={(event) => setAttributeColor(event.target.value)} />
                </div>
                <button className="w-full rounded-xl bg-indigo-500 py-3 font-medium hover:bg-indigo-400">Create attribute</button>
              </form>
              <div className="mt-5 space-y-3">
                {attributes.map((attribute) => (
                  <div key={attribute.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="font-semibold">{attribute.icon} {attribute.name}</div>
                    <div className="text-sm text-slate-400">{attribute.user.email} · value {attribute.value} · {attribute._count?.missions ?? 0} missions</div>
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => updateAttribute(attribute)} className="rounded-lg border border-slate-700 bg-white px-3 py-2 text-sm hover:bg-slate-800">Edit</button>
                      <button onClick={() => deleteAttribute(attribute)} className="rounded-lg border border-red-500/30 bg-white px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-xl font-bold">Notifications</h2>
              <form onSubmit={sendTestNotification} className="mt-4 space-y-3">
                <select className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" value={testUserId} onChange={(event) => setTestUserId(event.target.value)}>
                  <option value="">All subscribed users</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.email}</option>
                  ))}
                </select>
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" value={testTitle} onChange={(event) => setTestTitle(event.target.value)} />
                <textarea className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" rows={3} value={testBody} onChange={(event) => setTestBody(event.target.value)} />
                <button className="w-full rounded-xl bg-indigo-500 py-3 font-medium hover:bg-indigo-400">Send test notification</button>
              </form>
              <div className="mt-5 space-y-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <h3 className="font-semibold">Templates</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Variables: mission {"{remaining} {completed} {total}"} · event {"{eventTitle} {location} {date} {content}"}
                  </p>
                  <div className="mt-3 space-y-2">
                    {templates.map((template) => (
                      <div key={template.id} className="rounded-lg border border-slate-800 p-3">
                        <div className="font-semibold">{template.type}</div>
                        <div className="text-sm text-slate-300">{template.title}</div>
                        <div className="text-xs text-slate-400">{template.body}</div>
                        <button onClick={() => updateTemplate(template)} className="mt-2 rounded-lg border border-slate-700 bg-white px-3 py-2 text-sm hover:bg-slate-800">Edit template</button>
                      </div>
                    ))}
                  </div>
                </div>

                {subscriptions.length === 0 && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-slate-400">No push subscriptions yet.</div>
                )}
                {subscriptions.map((subscription) => (
                  <div key={subscription.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="font-semibold">{subscription.user.email}</div>
                    <div className="truncate text-sm text-slate-400">{subscription.endpoint}</div>
                    <button onClick={() => deleteSubscription(subscription)} className="mt-3 rounded-lg border border-red-500/30 bg-white px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">Delete subscription</button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
