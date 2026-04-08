import { useEffect, useMemo, useState } from "react";
import { fetchJson, sendJson, formatShortDate } from "../data/api";
import { seedPatients, seedUpcomingSessions, seedPayments, DAY_ORDER } from "../data/seedData";

function getInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export function useCardiganData() {
  const [patients, setPatients] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const [patientsData, sessionsData, paymentsData] = await Promise.all([
          fetchJson("/patients"),
          fetchJson("/sessions/upcoming"),
          fetchJson("/payments"),
        ]);
        if (cancelled) return;
        setPatients(Array.isArray(patientsData) ? patientsData : []);
        setUpcomingSessions(Array.isArray(sessionsData) ? sessionsData : []);
        setPayments(Array.isArray(paymentsData) ? paymentsData : []);
      } catch (err) {
        if (cancelled) return;
        setPatients(seedPatients);
        setUpcomingSessions(seedUpcomingSessions);
        setPayments(seedPayments);
        setError(err instanceof Error ? err.message : "No se pudieron cargar los datos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    const totalBilled = patients.reduce((sum, p) => sum + p.billed, 0);
    const totalPaid = patients.reduce((sum, p) => sum + p.paid, 0);
    return {
      totalBilled,
      totalPaid,
      totalOwed: totalBilled - totalPaid,
    };
  }, [patients]);

  async function createPayment({ patientName, amount, method = "Transferencia", date = formatShortDate() }) {
    const parsedAmount = Number(amount);
    if (!patientName || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return false;

    const priorPatients = patients;
    const priorPayments = payments;
    const targetPatient = patients.find(p => p.name === patientName);
    const tempId = `tmp-${Date.now()}`;
    const tempPayment = {
      id: tempId,
      patient: patientName,
      initials: targetPatient?.initials || patientName.slice(0, 2).toUpperCase(),
      amount: parsedAmount,
      date,
      method,
      colorIdx: 0,
    };

    setMutationError("");
    setMutating(true);
    setPayments(prev => [...prev, tempPayment]);
    setPatients(prev => prev.map(p => (
      p.name === patientName ? { ...p, paid: p.paid + parsedAmount } : p
    )));

    try {
      const created = await sendJson("/payments", "POST", {
        patient: patientName,
        amount: parsedAmount,
        method,
        date,
      });
      if (created && typeof created === "object") {
        setPayments(prev => prev.map(p => (p.id === tempId ? { ...p, ...created } : p)));
      }
      return true;
    } catch (err) {
      setPayments(priorPayments);
      setPatients(priorPatients);
      setMutationError(err instanceof Error ? err.message : "No se pudo registrar el pago.");
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function updateSessionStatus(sessionId, status) {
    const priorSessions = upcomingSessions;
    setMutationError("");
    setMutating(true);
    setUpcomingSessions(prev => prev.map(s => (
      s.id === sessionId ? { ...s, status } : s
    )));
    try {
      await sendJson(`/sessions/${sessionId}`, "PATCH", { status });
      return true;
    } catch (err) {
      setUpcomingSessions(priorSessions);
      setMutationError(err instanceof Error ? err.message : "No se pudo actualizar la sesión.");
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function createPatient({ name, parent, rate, day, time }) {
    if (!name?.trim()) return false;
    const tempId = `tmp-${Date.now()}`;
    const newPatient = {
      id: tempId,
      name: name.trim(),
      parent: parent?.trim() || "",
      initials: getInitials(name),
      rate: Number(rate) || 700,
      day: day || "Lunes",
      time: time || "16:00",
      status: "active",
      billed: 0,
      paid: 0,
      sessions: 0,
    };

    setMutationError("");
    setMutating(true);
    setPatients(prev => [...prev, newPatient]);

    try {
      const created = await sendJson("/patients", "POST", newPatient);
      if (created && typeof created === "object") {
        setPatients(prev => prev.map(p => (p.id === tempId ? { ...p, ...created } : p)));
      }
    } catch {
      // keep optimistic update — API may not exist yet
    } finally {
      setMutating(false);
    }
    return true;
  }

  async function createSession({ patientName, date, time }) {
    if (!patientName?.trim() || !date?.trim() || !time?.trim()) return false;
    const patient = patients.find(p => p.name === patientName);

    // derive day name from date string (e.g. "10 Abr" → "Jueves")
    const [dayNum, monthStr] = date.split(" ");
    const monthIdx = SHORT_MONTHS.indexOf(monthStr);
    const dateObj = new Date(2026, monthIdx >= 0 ? monthIdx : 3, parseInt(dayNum) || 1);
    const dayName = DAY_ORDER[(dateObj.getDay() + 6) % 7];

    const tempId = `tmp-${Date.now()}`;
    const newSession = {
      id: tempId,
      patient: patientName.trim(),
      initials: patient?.initials || getInitials(patientName),
      time: time.trim(),
      day: dayName,
      date: date.trim(),
      status: "scheduled",
      colorIdx: patient ? patients.indexOf(patient) % 7 : 0,
    };

    setMutationError("");
    setMutating(true);
    setUpcomingSessions(prev => [...prev, newSession]);

    try {
      const created = await sendJson("/sessions", "POST", newSession);
      if (created && typeof created === "object") {
        setUpcomingSessions(prev => prev.map(s => (s.id === tempId ? { ...s, ...created } : s)));
      }
    } catch {
      // keep optimistic update
    } finally {
      setMutating(false);
    }
    return true;
  }

  return {
    patients,
    upcomingSessions,
    payments,
    loading,
    error,
    totals,
    mutating,
    mutationError,
    createPayment,
    createPatient,
    createSession,
    updateSessionStatus,
  };
}
