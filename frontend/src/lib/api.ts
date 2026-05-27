import { API_BASE } from "./config";

export { API_BASE };

export async function readJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

export async function uploadDocument(file: File): Promise<unknown> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE}/documents`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}
