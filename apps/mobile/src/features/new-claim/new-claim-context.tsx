import { useSession } from '@/features/session/session-context';
import { randomUUID } from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import * as attachmentsRepo from '@/db/attachments-repo';
import { getDatabase } from '@/db/database';
import * as draftsRepo from '@/db/drafts-repo';
import * as queueRepo from '@/db/queue-repo';
import type { Attachment } from '@/db/types';
import { capturePhoto } from './photo-capture';
import { MAX_PHOTOS, validateDraft, type DraftValidation } from './validate';

/**
 * State for the new-claim wizard, shared across its four steps. SQLite is the source of
 * truth once the draft is persisted, so progress survives an app restart. `clientClaimId`
 * is minted once and reused on every submit attempt — the server-side duplicate guard.
 */
interface NewClaimValue {
  loading: boolean;
  loadError: string | null;
  draftId: string | null;
  policyNumber: string | null;
  incidentDescription: string;
  incidentDate: string;
  attachments: Attachment[];
  validation: DraftValidation;
  setPolicyNumber: (value: string) => void;
  setIncidentDescription: (value: string) => void;
  setIncidentDate: (value: string) => void;
  addPhoto: (source: 'camera' | 'library') => Promise<string | null>;
  removePhoto: (attachmentId: string) => Promise<void>;
  saveDraft: () => Promise<string>;
  submit: () => Promise<string>;
}

const NewClaimContext = createContext<NewClaimValue | null>(null);

export function NewClaimProvider({ initialDraftId, children }: { initialDraftId?: string; children: ReactNode }) {
  const { customerId } = useSession();
  const [loadError, setLoadError] = useState<string | null>(null);
  const persistence = useRef<Promise<string> | null>(null);
  const [loading, setLoading] = useState(!!initialDraftId);
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);
  const [clientClaimId, setClientClaimId] = useState(() => randomUUID());
  const [policyNumber, setPolicyNumber] = useState<string | null>(null);
  const [incidentDescription, setIncidentDescription] = useState('');
  const [incidentDate, setIncidentDate] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useEffect(() => {
    if (!initialDraftId) return;
    let cancelled = false;
    void (async () => {
      try {
        const db = await getDatabase(customerId);
        const [draft, submission, savedAttachments] = await Promise.all([
          draftsRepo.getDraft(db, initialDraftId),
          queueRepo.getSubmission(db, initialDraftId),
          attachmentsRepo.listAttachments(db, initialDraftId),
        ]);
        if (cancelled) return;
        if (!draft || !submission || submission.claimId || !['draft', 'needs_attention'].includes(submission.state)) {
          throw new Error('This saved draft is unavailable or has already been queued.');
        }
        setLoadError(null);
        setDraftId(draft.draftId);
        setClientClaimId(draft.clientClaimId);
        setPolicyNumber(draft.policyNumber);
        setIncidentDescription(draft.incidentDescription);
        setIncidentDate(draft.incidentDate);
        setAttachments(savedAttachments);
      } catch {
        if (!cancelled) setLoadError('Could not open this saved draft. Return to Claims and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialDraftId, customerId]);

  const validation = useMemo(
    () => validateDraft({ policyNumber, incidentDescription, incidentDate }),
    [policyNumber, incidentDescription, incidentDate],
  );

  const persist = useCallback(async (): Promise<string> => {
    const db = await getDatabase(customerId);
    const now = new Date().toISOString();
    if (draftId) {
      const existing = await draftsRepo.getDraft(db, draftId);
      const submission = await queueRepo.getSubmission(db, draftId);
      if (!existing || !submission) throw new Error('This draft is unavailable for this account');
      if (submission.claimId || !['draft', 'needs_attention'].includes(submission.state)) {
        throw new Error('This claim is already queued or accepted. Track it from Claims.');
      }
      await draftsRepo.updateDraft(db, draftId, {
        policyNumber: policyNumber ?? undefined,
        incidentDescription,
        incidentDate,
        now,
      });
      return draftId;
    }
    const id = randomUUID();
    await draftsRepo.createDraft(db, {
      draftId: id,
      clientClaimId,
      policyNumber: policyNumber ?? '',
      incidentDescription,
      incidentDate,
      now,
    });
    setDraftId(id);
    return id;
  }, [customerId, draftId, clientClaimId, policyNumber, incidentDescription, incidentDate]);

  const ensurePersisted = useCallback((): Promise<string> => {
    if (persistence.current) return persistence.current;
    const pending = persist();
    persistence.current = pending;
    void pending.finally(() => { if (persistence.current === pending) persistence.current = null; }).catch(() => {});
    return pending;
  }, [persist]);

  const reloadAttachments = useCallback(async (forDraftId: string) => {
    const db = await getDatabase(customerId);
    setAttachments(await attachmentsRepo.listAttachments(db, forDraftId));
  }, [customerId]);

  const addPhoto = useCallback(
    async (source: 'camera' | 'library'): Promise<string | null> => {
      if (attachments.length >= MAX_PHOTOS) return 'You can attach at most 10 files';
      try {
        const id = await ensurePersisted();
        const captured = await capturePhoto(source, id);
        if (!captured) return null;
        const db = await getDatabase(customerId);
        await attachmentsRepo.addAttachment(db, { draftId: id, ...captured });
        await reloadAttachments(id);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : 'Could not add the photo';
      }
    },
    [customerId, attachments.length, ensurePersisted, reloadAttachments],
  );

  const removePhoto = useCallback(
    async (attachmentId: string) => {
      const db = await getDatabase(customerId);
      if (!draftId) return;
      const submission = await queueRepo.getSubmission(db, draftId);
      if (!submission || submission.claimId || !['draft', 'needs_attention'].includes(submission.state)) {
        throw new Error('This claim is already queued or accepted. Its saved evidence must be kept for recovery.');
      }
      const target = attachments.find((a) => a.attachmentId === attachmentId);
      await attachmentsRepo.removeAttachment(db, attachmentId);
      if (target) {
        try {
          const { File } = await import('expo-file-system');
          const file = new File(target.localUri);
          if (file.exists) file.delete();
        } catch {
          // File cleanup is best-effort; the DB row is already gone.
        }
      }
      if (draftId) await reloadAttachments(draftId);
      else setAttachments((current) => current.filter((a) => a.attachmentId !== attachmentId));
    },
    [customerId, attachments, draftId, reloadAttachments],
  );

  const saveDraft = useCallback(async (): Promise<string> => ensurePersisted(), [ensurePersisted]);

  const submit = useCallback(async (): Promise<string> => {
    if (!validation.valid) throw new Error('Please complete the incident details before submitting');
    const id = await ensurePersisted();
    const db = await getDatabase(customerId);
    await queueRepo.enqueueDraft(db, id, new Date().toISOString());
    return id;
  }, [customerId, ensurePersisted, validation.valid]);

  const value = useMemo<NewClaimValue>(
    () => ({
      loading,
      loadError,
      draftId,
      policyNumber,
      incidentDescription,
      incidentDate,
      attachments,
      validation,
      setPolicyNumber,
      setIncidentDescription,
      setIncidentDate,
      addPhoto,
      removePhoto,
      saveDraft,
      submit,
    }),
    [loading, loadError, draftId, policyNumber, incidentDescription, incidentDate, attachments, validation, addPhoto, removePhoto, saveDraft, submit],
  );

  return <NewClaimContext.Provider value={value}>{children}</NewClaimContext.Provider>;
}

export function useNewClaim(): NewClaimValue {
  const value = useContext(NewClaimContext);
  if (!value) throw new Error('useNewClaim must be used within a NewClaimProvider');
  return value;
}
