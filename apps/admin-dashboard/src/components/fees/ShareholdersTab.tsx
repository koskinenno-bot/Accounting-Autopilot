import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { importShareholders, updateApartment } from '../../api/fees';
import type { Apartment, FeeSetup, ImportSummary } from '../../api/fees';
import { ErrorBox, InfoBox, errorText, inputClass, smallButton } from './common';

const EXAMPLE = 'Huoneisto;Pinta-ala;Osakkeet;Omistaja;Sähköposti;Henkilöt;Autopaikat\nA 1;35,5;1-350;Aino Esimerkki;aino@esimerkki.fi;1;0';

/** Tiedosto tekstiksi. Isännöintijärjestelmien CSV on usein Windows-1252-merkistöä, joten UTF-8:n virheet tulkitaan uudelleen. */
const readCsv = async (file: File) => {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
};

const ApartmentRow = ({ companyId, apartment, canWrite, onSaved }: { companyId: string; apartment: Apartment; canWrite: boolean; onSaved: () => void }) => {
  const [draft, setDraft] = useState({
    squareMeters: String(apartment.squareMeters).replace('.', ','),
    persons: String(apartment.persons),
    parkingSpots: String(apartment.parkingSpots),
  });
  const [error, setError] = useState<string | null>(null);
  const dirty = draft.squareMeters !== String(apartment.squareMeters).replace('.', ',')
    || draft.persons !== String(apartment.persons) || draft.parkingSpots !== String(apartment.parkingSpots);
  const save = useMutation({
    mutationFn: () => updateApartment({
      companyId, apartment: apartment.apartment,
      squareMeters: Number(draft.squareMeters.replace(',', '.')), persons: Number(draft.persons), parkingSpots: Number(draft.parkingSpots),
    }),
    onSuccess: () => { setError(null); onSaved(); },
    onError: (err) => setError(errorText(err)),
  });
  const input = (key: keyof typeof draft) => (
    <input className={`${inputClass} w-20 text-right`} disabled={!canWrite} value={draft[key]}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
  );
  return (
    <tr className="border-b border-white/5 align-top">
      <td className="p-2 font-semibold">{apartment.apartment}</td>
      <td className="p-2">
        {apartment.owners.map((o) => (
          <div key={o.shareholderId}>{o.name} <span className="text-xs text-slate-500">{o.email || 'ei sähköpostia'}</span></div>
        ))}
      </td>
      <td className="p-2 text-right">{apartment.shares.toLocaleString('fi-FI')}</td>
      <td className="p-2 text-right">{input('squareMeters')}</td>
      <td className="p-2 text-right">{input('persons')}</td>
      <td className="p-2 text-right">{input('parkingSpots')}</td>
      <td className="p-2 text-right">
        {canWrite && dirty && <button type="button" className={smallButton} disabled={save.isPending} onClick={() => save.mutate()}>Tallenna</button>}
        {error && <div className="text-xs text-rose-300">{error}</div>}
      </td>
    </tr>
  );
};

const ShareholdersTab = ({ companyId, setup, canWrite, onSaved }: { companyId: string; setup: FeeSetup; canWrite: boolean; onSaved: () => void }) => {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useMutation({
    mutationFn: (text: string) => importShareholders(companyId, text, true),
    onSuccess: (r) => { setPreview(r); setError(null); },
    onError: (err) => setError(errorText(err)),
  });
  const doImport = useMutation({
    mutationFn: () => importShareholders(companyId, csv!, false),
    onSuccess: (r) => {
      setMessage(`Osakasluettelo tuotu: ${r.apartments} huoneistoa, ${r.owners} osakasta.`);
      setPreview(null); setCsv(null); setFileName('');
      onSaved();
    },
    onError: (err) => setError(errorText(err)),
  });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    const text = await readCsv(file);
    setCsv(text);
    setFileName(file.name);
    check.mutate(text);
  };

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="glass-card p-5 space-y-3">
          <h3 className="font-semibold">Tuo osakasluettelo isännöintijärjestelmästä (CSV)</h3>
          <p className="text-sm text-slate-400">
            Vie osakasluettelo isännöintijärjestelmästä CSV-tiedostoksi. Sarakkeet tunnistetaan otsikoista: Huoneisto, Pinta-ala,
            Osakkeet, Omistaja (tai Etunimi ja Sukunimi), Sähköposti, Puhelin, Henkilöt ja Autopaikat. Saman huoneiston useampi
            omistaja tulee omille riveilleen. Tuonti korvaa yhtiön nykyisen osakasluettelon.
          </p>
          <pre className="text-xs text-slate-500 bg-slate-900/50 rounded-lg p-3 overflow-x-auto">{EXAMPLE}</pre>
          <label className={`${smallButton} inline-flex items-center gap-2 cursor-pointer`}>
            <Upload className="w-4 h-4" />Valitse CSV-tiedosto
            <input type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {fileName && <span className="ml-3 text-sm text-slate-400">{fileName}</span>}
          <ErrorBox text={error} />
          {message && <InfoBox>{message}</InfoBox>}
          {preview && (
            <div className="space-y-3">
              {preview.errors.length > 0 && <ErrorBox text={`Korjaa tiedosto: ${preview.errors.join(' · ')}`} />}
              {preview.warnings.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm space-y-1">
                  {preview.warnings.map((w) => <div key={w}>{w}</div>)}
                </div>
              )}
              {preview.errors.length === 0 && (
                <>
                  <div className="text-sm">Tiedostossa {preview.apartments} huoneistoa ja {preview.owners} osakasta.</div>
                  <div className="max-h-64 overflow-y-auto text-sm">
                    <table className="w-full">
                      <tbody>
                        {preview.preview?.map((a) => (
                          <tr key={a.number} className="border-b border-white/5">
                            <td className="p-1.5 font-semibold">{a.number}</td>
                            <td className="p-1.5">{a.owners.map((o) => o.name).join(', ')}</td>
                            <td className="p-1.5 text-right">{a.squareMeters.toLocaleString('fi-FI')} m²</td>
                            <td className="p-1.5 text-right">{a.shareNumbers.join(', ')}</td>
                            <td className="p-1.5 text-right">{a.persons} hlö</td>
                            <td className="p-1.5 text-right">{a.parkingSpots} ap</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" className="premium-button premium-gradient text-white" disabled={doImport.isPending} onClick={() => doImport.mutate()}>
                    Tuo {preview.apartments} huoneistoa
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="glass-card p-5 overflow-x-auto">
        <h3 className="font-semibold mb-2">Huoneistot ({setup.apartments.length})</h3>
        <ErrorBox text={setup.apartmentsError} />
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-white/5">
              <th className="p-2 font-medium">Huoneisto</th>
              <th className="p-2 font-medium">Osakkaat</th>
              <th className="p-2 font-medium text-right">Osakkeet</th>
              <th className="p-2 font-medium text-right">m²</th>
              <th className="p-2 font-medium text-right">Henkilöt</th>
              <th className="p-2 font-medium text-right">Autopaikat</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {setup.apartments.map((a) => (
              <ApartmentRow key={`${a.apartment}-${a.squareMeters}-${a.persons}-${a.parkingSpots}`} companyId={companyId} apartment={a} canWrite={canWrite} onSaved={onSaved} />
            ))}
          </tbody>
        </table>
        {setup.apartments.length === 0 && !setup.apartmentsError && (
          <div className="p-6 text-center text-slate-400">Osakasluettelo on tyhjä. Tuo se CSV-tiedostona.</div>
        )}
      </div>
    </div>
  );
};

export default ShareholdersTab;
