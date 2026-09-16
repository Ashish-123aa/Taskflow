import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, UploadCloud } from 'lucide-react';
import { api, ApiRequestError } from '../lib/api';
import { JOB_PRIORITIES, JOB_TYPES, JOB_TYPE_LABELS, type JobPriority, type JobType } from '../lib/constants';
import type { ApiSuccess, Job } from '../lib/types';
import { Button, Card } from '../components/ui';
import { Field } from './AuthShell';
import { useToast } from '../contexts/ToastContext';

/**
 * One page, but the form beneath the shared name/priority fields adapts
 * to the selected job type — an API_REQUEST job needs a URL, an EMAIL job
 * needs a recipient, CSV/IMAGE_PROCESSING need an actual file (so they
 * go through the dedicated upload endpoints, not a JSON payload at all).
 * A single generic "paste JSON payload" textarea for every type would be
 * more code-efficient but a worse experience for exactly the types
 * people create most often — so only DATA_TRANSFORMATION and
 * REPORT_GENERATION, whose payloads are either inherently structured
 * (nested operations) or trivial (empty), fall back to that.
 */
export function JobCreatePage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [type, setType] = useState<JobType>('API_REQUEST');
  const [priority, setPriority] = useState<JobPriority>('MEDIUM');
  const [maxAttempts, setMaxAttempts] = useState('');

  const [url, setUrl] = useState('');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [rawPayload, setRawPayload] = useState('{}');
  const [file, setFile] = useState<File | null>(null);

  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const commonFields = {
        name: name || JOB_TYPE_LABELS[type],
        priority,
        ...(maxAttempts ? { maxAttempts: Number(maxAttempts) } : {}),
      };

      if (type === 'CSV_PROCESSING' || type === 'IMAGE_PROCESSING') {
        if (!file) throw new Error('Choose a file to upload');
        const formData = new FormData();
        formData.append('file', file);
        formData.append('name', commonFields.name);
        formData.append('priority', priority);
        const endpoint = type === 'CSV_PROCESSING' ? '/jobs/upload/csv' : '/jobs/upload/image';
        const res = await api.post<ApiSuccess<Job>>(endpoint, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        return res.data.data;
      }

      let payload: Record<string, unknown>;
      if (type === 'API_REQUEST' || type === 'SCHEDULED_API_FETCH') {
        payload = { url, method };
      } else if (type === 'EMAIL') {
        payload = { to: emailTo, subject: emailSubject, body: emailBody };
      } else {
        try {
          payload = JSON.parse(rawPayload) as Record<string, unknown>;
        } catch {
          throw new Error('Payload must be valid JSON');
        }
      }

      const res = await api.post<ApiSuccess<Job>>('/jobs', { ...commonFields, type, payload });
      return res.data.data;
    },
    onSuccess: (job) => {
      showToast('Job created', 'success');
      navigate(`/jobs/${job.id}`);
    },
    onError: (err) => {
      setFormError(err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : 'Could not create job');
    },
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/jobs')}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-display text-xl font-bold text-slate-900">New job</h1>
      </div>

      <Card className="p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            createMutation.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Job type">
            <select value={type} onChange={(e) => setType(e.target.value as JobType)} className="input">
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {JOB_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Name (optional)">
            <input
              type="text"
              className="input"
              placeholder={JOB_TYPE_LABELS[type]}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value as JobPriority)} className="input">
                {JOB_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Max attempts (optional, 1–10)">
              <input
                type="number"
                min={1}
                max={10}
                className="input"
                placeholder="Defaults to 3"
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(e.target.value)}
              />
            </Field>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <TypeSpecificFields
              type={type}
              url={url}
              setUrl={setUrl}
              method={method}
              setMethod={setMethod}
              emailTo={emailTo}
              setEmailTo={setEmailTo}
              emailSubject={emailSubject}
              setEmailSubject={setEmailSubject}
              emailBody={emailBody}
              setEmailBody={setEmailBody}
              rawPayload={rawPayload}
              setRawPayload={setRawPayload}
              file={file}
              setFile={setFile}
            />
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <Button type="submit" isLoading={createMutation.isPending} className="mt-1">
            Create job
          </Button>
        </form>
      </Card>
    </div>
  );
}

interface TypeFieldsProps {
  type: JobType;
  url: string;
  setUrl: (v: string) => void;
  method: 'GET' | 'POST';
  setMethod: (v: 'GET' | 'POST') => void;
  emailTo: string;
  setEmailTo: (v: string) => void;
  emailSubject: string;
  setEmailSubject: (v: string) => void;
  emailBody: string;
  setEmailBody: (v: string) => void;
  rawPayload: string;
  setRawPayload: (v: string) => void;
  file: File | null;
  setFile: (f: File | null) => void;
}

function TypeSpecificFields(props: TypeFieldsProps) {
  const { type } = props;

  if (type === 'API_REQUEST' || type === 'SCHEDULED_API_FETCH') {
    return (
      <div className="flex flex-col gap-4">
        <Field label="URL">
          <input
            type="url"
            required
            placeholder="https://api.open-meteo.com/v1/forecast?..."
            className="input"
            value={props.url}
            onChange={(e) => props.setUrl(e.target.value)}
          />
        </Field>
        <Field label="Method">
          <select
            className="input w-auto"
            value={props.method}
            onChange={(e) => props.setMethod(e.target.value as 'GET' | 'POST')}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </Field>
      </div>
    );
  }

  if (type === 'EMAIL') {
    return (
      <div className="flex flex-col gap-4">
        <Field label="Recipient">
          <input
            type="email"
            required
            className="input"
            value={props.emailTo}
            onChange={(e) => props.setEmailTo(e.target.value)}
          />
        </Field>
        <Field label="Subject">
          <input
            type="text"
            required
            className="input"
            value={props.emailSubject}
            onChange={(e) => props.setEmailSubject(e.target.value)}
          />
        </Field>
        <Field label="Body">
          <textarea
            required
            rows={4}
            className="input"
            value={props.emailBody}
            onChange={(e) => props.setEmailBody(e.target.value)}
          />
        </Field>
      </div>
    );
  }

  if (type === 'CSV_PROCESSING' || type === 'IMAGE_PROCESSING') {
    return (
      <Field label={type === 'CSV_PROCESSING' ? 'CSV file' : 'Image file'}>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center hover:border-brand-400 hover:bg-brand-50/40">
          <UploadCloud size={22} className="text-slate-400" />
          <span className="text-sm text-slate-500">
            {props.file ? props.file.name : 'Click to choose a file'}
          </span>
          <input
            type="file"
            className="hidden"
            accept={type === 'CSV_PROCESSING' ? '.csv,text/csv' : 'image/jpeg,image/png,image/webp'}
            onChange={(e) => props.setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </Field>
    );
  }

  return (
    <Field label="Payload (JSON)">
      <textarea
        rows={6}
        className="input font-mono text-xs"
        value={props.rawPayload}
        onChange={(e) => props.setRawPayload(e.target.value)}
      />
      <span className="text-xs text-slate-400">
        {type === 'DATA_TRANSFORMATION'
          ? 'e.g. { "input": [...], "operations": [{ "type": "filter", ... }] }'
          : 'REPORT_GENERATION can usually be left as {}.'}
      </span>
    </Field>
  );
}
