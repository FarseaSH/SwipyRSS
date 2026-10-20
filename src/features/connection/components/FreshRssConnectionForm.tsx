import { Eye, EyeOff, KeyRound, Link2, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { FreshRssConnectionInput } from "@/types";

type Props = {
  initialValue: FreshRssConnectionInput;
  passwordRequired: boolean;
  submitLabel: string;
  onSubmit: (connection: FreshRssConnectionInput) => Promise<void>;
  onCancel?: () => void;
};

/**
 * Collect connection details and handle input validation and error feedback during submission.
 * 收集连接信息，并负责提交期间的输入校验和错误反馈。
 */
export function FreshRssConnectionForm({ initialValue, passwordRequired, submitLabel, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState(initialValue);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setForm(initialValue), [initialValue]);

  /**
   * Clear the previous submission error when updating an individual field.
   * 更新单个字段时同步清理上一次提交错误。
   */
  const update = (field: keyof FreshRssConnectionInput, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (error) setError("");
  };

  /**
   * Perform basic offline validation first, then delegate connection testing and saving to the
   * current runtime adapter.
   *
   * 先完成无需联网的基础校验，再把连接测试和保存交给当前运行时适配器。
   */
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const connection = {
      apiUrl: form.apiUrl.trim(),
      username: form.username.trim(),
      password: form.password,
    };
    if (!connection.apiUrl || !connection.username || (passwordRequired && !connection.password)) {
      setError(passwordRequired ? "请填写 API 地址、账号和 API 密码" : "请填写 API 地址和账号");
      return;
    }
    try {
      const url = new URL(connection.apiUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    } catch {
      setError("请输入完整的 HTTP 或 HTTPS API 地址");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(connection);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "连接失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="connection-form" onSubmit={submit} noValidate>
      <label className="connection-field">
        <span className="connection-label">API 地址</span>
        <span className="connection-input-wrap">
          <Link2 size={18} aria-hidden="true"/>
          <input type="url" value={form.apiUrl} onChange={(event) => update("apiUrl", event.target.value)} placeholder="https://rss.example.com/api/greader.php" autoComplete="url" spellCheck={false}/>
        </span>
        <span className="connection-help">填写 FreshRSS 的 Google Reader compatible API 地址</span>
      </label>

      <label className="connection-field">
        <span className="connection-label">账号</span>
        <span className="connection-input-wrap">
          <UserRound size={18} aria-hidden="true"/>
          <input type="text" value={form.username} onChange={(event) => update("username", event.target.value)} placeholder="FreshRSS 用户名" autoComplete="username"/>
        </span>
      </label>

      <label className="connection-field">
        <span className="connection-label">API 密码</span>
        <span className="connection-input-wrap">
          <KeyRound size={18} aria-hidden="true"/>
          <input type={passwordVisible ? "text" : "password"} value={form.password} onChange={(event) => update("password", event.target.value)} placeholder={passwordRequired ? "FreshRSS API 密码" : "留空则保持原密码"} autoComplete="current-password"/>
          <button type="button" className="connection-password-toggle" onClick={() => setPasswordVisible((visible) => !visible)} aria-label={passwordVisible ? "隐藏密码" : "显示密码"}>
            {passwordVisible ? <EyeOff size={18}/> : <Eye size={18}/>}
          </button>
        </span>
      </label>

      <div className={`connection-error ${error ? "visible" : ""}`} role="alert">{error}</div>
      <div className="connection-actions">
        {onCancel ? <button type="button" className="connection-secondary-button" onClick={onCancel}>取消</button> : null}
        <button type="submit" className="connection-primary-button" disabled={submitting}>{submitting ? "正在连接…" : submitLabel}</button>
      </div>
    </form>
  );
}
