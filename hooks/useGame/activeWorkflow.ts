import { useRef, useState } from 'react';
import type { TurnRecoveryContext } from '@/models/turnRecovery';
import { TURN_STATUS_IDLE, type TurnStatus } from './turnStatus';

export interface ActiveWorkflowStore {
  loading: boolean;
  turnStatus: TurnStatus;
  liveRecallSummary: string;
  liveRecallFullContent: string;
  pendingVariable: boolean;
  recovery: TurnRecoveryContext | null;
  sessionEpoch: number;

  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setTurnStatus: React.Dispatch<React.SetStateAction<TurnStatus>>;
  setLiveRecallSummary: React.Dispatch<React.SetStateAction<string>>;
  setLiveRecallFullContent: React.Dispatch<React.SetStateAction<string>>;
  setPendingVariable: React.Dispatch<React.SetStateAction<boolean>>;
  setRecovery: React.Dispatch<React.SetStateAction<TurnRecoveryContext | null>>;
  setSessionEpoch: React.Dispatch<React.SetStateAction<number>>;

  abortControllerRef: React.RefObject<AbortController | null>;
  rerollContextRef: React.RefObject<{ nonce: string; previousResponse: string } | null>;
}

export function useActiveWorkflow(): ActiveWorkflowStore {
  const [loading, setLoading] = useState(false);
  const [turnStatus, setTurnStatus] = useState<TurnStatus>(TURN_STATUS_IDLE);
  const [liveRecallSummary, setLiveRecallSummary] = useState('');
  const [liveRecallFullContent, setLiveRecallFullContent] = useState('');
  const [pendingVariable, setPendingVariable] = useState(false);
  const [recovery, setRecovery] = useState<TurnRecoveryContext | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const rerollContextRef = useRef<{ nonce: string; previousResponse: string } | null>(null);

  return {
    loading,
    turnStatus,
    liveRecallSummary,
    liveRecallFullContent,
    pendingVariable,
    recovery,
    sessionEpoch,
    setLoading,
    setTurnStatus,
    setLiveRecallSummary,
    setLiveRecallFullContent,
    setPendingVariable,
    setRecovery,
    setSessionEpoch,
    abortControllerRef,
    rerollContextRef,
  };
}
