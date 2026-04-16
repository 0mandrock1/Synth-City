import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Stage, Layer, Rect, Text, Group, Line, Circle } from 'react-konva';
import { auth, db, loginWithGoogle, logout } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, query, where, getDoc, writeBatch } from 'firebase/firestore';
import { BuildingData, UserProfile, BuildingType, WaveType } from './types';
import { audioEngine } from './lib/audio';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Music, Building2, User as UserIcon, LogOut, Plus, Trash2, Zap, Trophy, Info, 
  AlertTriangle, Undo2, Redo2, MousePointer2, Settings2, Volume2, Waves, 
  Music2, ChevronRight, X, Route, Star, ArrowUpCircle, Activity
} from 'lucide-react';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface HistoryAction {
  type: 'place' | 'delete' | 'update';
  data: BuildingData;
  prevData?: BuildingData;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black flex items-center justify-center p-6 text-center">
          <div className="space-y-4">
            <AlertTriangle className="mx-auto text-yellow-500" size={48} />
            <h1 className="text-2xl font-bold">System Error</h1>
            <p className="text-gray-400 max-w-md">{this.state.error?.message || "Unknown error"}</p>
            <button onClick={() => window.location.reload()} className="px-6 py-2 bg-white text-black rounded-lg font-bold">Restart Grid</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const GRID_SIZE = 50;
const WORLD_SIZE = 4000;
const NOTES = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'];
const WAVES: WaveType[] = ['sine', 'square', 'sawtooth', 'triangle'];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [buildings, setBuildings] = useState<BuildingData[]>([]);
  const [selectedType, setSelectedType] = useState<BuildingType>('oscillator');
  const [activeTool, setActiveTool] = useState<'select' | 'place' | 'delete' | 'road'>('place');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAudioStarted, setIsAudioStarted] = useState(false);
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 0.8 });
  const [showInfo, setShowInfo] = useState(false);
  const [meterValue, setMeterValue] = useState(-100);
  
  // Undo/Redo stacks
  const [history, setHistory] = useState<HistoryAction[]>([]);
  const [future, setFuture] = useState<HistoryAction[]>([]);

  // Auth & Profile
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const userRef = doc(db, 'users', u.uid);
        try {
          const snap = await getDoc(userRef);
          if (!snap.exists()) {
            const newProfile: UserProfile = {
              uid: u.uid,
              displayName: u.displayName || 'Anonymous Synth',
              harmonyPoints: 500,
              xp: 0,
              level: 1,
            };
            await setDoc(userRef, newProfile);
            setProfile(newProfile);
          } else {
            setProfile(snap.data() as UserProfile);
          }
        } catch (err) {
          console.error(err);
        }
      } else {
        setProfile(null);
      }
    });
    return unsub;
  }, []);

  // Real-time Buildings
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'buildings'));
    const unsub = onSnapshot(q, (snap) => {
      const bData = snap.docs.map(doc => doc.data() as BuildingData);
      setBuildings(bData);
      if (isAudioStarted) {
        audioEngine.updateBuildings(bData);
      }
    });
    return unsub;
  }, [user, isAudioStarted]);

  // Visualizer Loop
  useEffect(() => {
    if (!isAudioStarted) return;
    let frame: number;
    const loop = () => {
      setMeterValue(audioEngine.getMeterValue() as number);
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [isAudioStarted]);

  // Harmony Points & XP Generator
  useEffect(() => {
    if (!user || !profile) return;
    const interval = setInterval(async () => {
      const userBuildings = buildings.filter(b => b.ownerId === user.uid);
      if (userBuildings.length > 0) {
        const pointsToAdd = userBuildings.length * 5;
        const xpToAdd = userBuildings.length * 2;
        
        let newXp = profile.xp + xpToAdd;
        let newLevel = profile.level;
        const xpToNext = newLevel * 100;
        
        if (newXp >= xpToNext) {
          newXp -= xpToNext;
          newLevel += 1;
        }

        const userRef = doc(db, 'users', user.uid);
        try {
          await updateDoc(userRef, {
            harmonyPoints: profile.harmonyPoints + pointsToAdd,
            xp: newXp,
            level: newLevel
          });
        } catch (err) {
          console.error("HP/XP update failed", err);
        }
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [user, profile, buildings]);

  const handleStartAudio = async () => {
    await audioEngine.init();
    audioEngine.startTransport();
    audioEngine.updateBuildings(buildings);
    setIsAudioStarted(true);
  };

  const pushToHistory = (action: HistoryAction) => {
    setHistory(prev => [...prev.slice(-19), action]); // Keep last 20
    setFuture([]);
  };

  const handleUndo = async () => {
    if (history.length === 0 || !user) return;
    const action = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setFuture(prev => [...prev, action]);

    try {
      if (action.type === 'place') {
        await deleteDoc(doc(db, 'buildings', action.data.id));
      } else if (action.type === 'delete') {
        await setDoc(doc(db, 'buildings', action.data.id), action.data);
      } else if (action.type === 'update' && action.prevData) {
        await setDoc(doc(db, 'buildings', action.data.id), action.prevData);
      }
    } catch (err) {
      console.error("Undo failed", err);
    }
  };

  const handleRedo = async () => {
    if (future.length === 0 || !user) return;
    const action = future[future.length - 1];
    setFuture(prev => prev.slice(0, -1));
    setHistory(prev => [...prev, action]);

    try {
      if (action.type === 'place') {
        await setDoc(doc(db, 'buildings', action.data.id), action.data);
      } else if (action.type === 'delete') {
        await deleteDoc(doc(db, 'buildings', action.data.id));
      } else if (action.type === 'update') {
        await setDoc(doc(db, 'buildings', action.data.id), action.data);
      }
    } catch (err) {
      console.error("Redo failed", err);
    }
  };

  const handleStageClick = async (e: any) => {
    if (!user || !profile) return;
    
    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();
    const worldX = (pointer.x - camera.x) / camera.scale;
    const worldY = (pointer.y - camera.y) / camera.scale;
    const gridX = Math.floor(worldX / GRID_SIZE) * GRID_SIZE;
    const gridY = Math.floor(worldY / GRID_SIZE) * GRID_SIZE;

    const clickedBuilding = buildings.find(b => b.x === gridX && b.y === gridY);

    if (activeTool === 'select') {
      if (clickedBuilding) {
        setSelectedId(clickedBuilding.id);
      } else {
        setSelectedId(null);
      }
      return;
    }

    if (activeTool === 'delete') {
      if (clickedBuilding && clickedBuilding.ownerId === user.uid) {
        pushToHistory({ type: 'delete', data: clickedBuilding });
        await deleteDoc(doc(db, 'buildings', clickedBuilding.id));
      }
      return;
    }

    if (activeTool === 'place' || activeTool === 'road') {
      if (clickedBuilding) return;
      const cost = activeTool === 'road' ? 10 : 50;
      if (profile.harmonyPoints < cost) return;

      const newBuilding: BuildingData = {
        id: Math.random().toString(36).substr(2, 9),
        ownerId: user.uid,
        ownerName: user.displayName || 'Unknown',
        type: activeTool === 'road' ? 'road' : selectedType,
        x: gridX,
        y: gridY,
        color: activeTool === 'road' ? '#555' : 
               selectedType === 'oscillator' ? '#00f2ff' : 
               selectedType === 'sequencer' ? '#ff00ea' : 
               selectedType === 'arpeggiator' ? '#ffcc00' :
               selectedType === 'global_fx' ? '#ff3300' : '#7000ff',
        params: {
          note: NOTES[Math.abs(gridX + gridY) % NOTES.length],
          waveType: 'sine',
          volume: -20,
          pattern: [1, 0, 1, 0],
          reverb: 0.3,
          delay: 0.3,
          rate: '8n'
        },
        level: 1,
        createdAt: new Date().toISOString()
      };

      pushToHistory({ type: 'place', data: newBuilding });
      await setDoc(doc(db, 'buildings', newBuilding.id), newBuilding);
      await updateDoc(doc(db, 'users', user.uid), {
        harmonyPoints: profile.harmonyPoints - cost
      });
    }
  };

  const updateBuildingParam = async (id: string, updates: Partial<BuildingData['params']>) => {
    if (!user) return;
    const b = buildings.find(b => b.id === id);
    if (!b || b.ownerId !== user.uid) return;

    const newData = { ...b, params: { ...b.params, ...updates } };
    pushToHistory({ type: 'update', data: newData, prevData: b });
    await updateDoc(doc(db, 'buildings', id), { params: newData.params });
  };

  const handleUpgrade = async () => {
    if (!selectedBuilding || !user || !profile) return;
    const upgradeCost = selectedBuilding.level * 200;
    if (profile.harmonyPoints < upgradeCost) return;

    const newLevel = selectedBuilding.level + 1;
    const updates = { 
      level: newLevel,
      params: { 
        ...selectedBuilding.params, 
        volume: (selectedBuilding.params.volume || -20) + 2 
      } 
    };

    await updateDoc(doc(db, 'buildings', selectedBuilding.id), updates);
    await updateDoc(doc(db, 'users', user.uid), {
      harmonyPoints: profile.harmonyPoints - upgradeCost
    });
  };

  const getUnlockedBuildings = (level: number): BuildingType[] => {
    const types: BuildingType[] = ['oscillator'];
    if (level >= 2) types.push('sequencer');
    if (level >= 3) types.push('sampler');
    if (level >= 4) types.push('arpeggiator');
    if (level >= 5) types.push('fx');
    if (level >= 10) types.push('global_fx');
    return types;
  };

  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const scaleBy = 1.1;
    const stage = e.target.getStage();
    const oldScale = camera.scale;
    const pointer = stage.getPointerPosition();

    const mousePointTo = {
      x: (pointer.x - camera.x) / oldScale,
      y: (pointer.y - camera.y) / oldScale,
    };

    const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    const clampedScale = Math.max(0.1, Math.min(newScale, 5));

    setCamera({
      scale: clampedScale,
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    });
  };

  const selectedBuilding = buildings.find(b => b.id === selectedId);

  if (!user) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-[#111] border border-white/10 p-8 rounded-3xl text-center space-y-6 shadow-2xl"
        >
          <div className="w-20 h-20 bg-gradient-to-br from-cyan-500 to-purple-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Music className="text-white w-10 h-10" />
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight">Synth City</h1>
          <p className="text-gray-400 text-lg">Build the symphony of the future in a shared musical world.</p>
          <button 
            onClick={loginWithGoogle}
            className="w-full py-4 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-all flex items-center justify-center gap-3 active:scale-95"
          >
            <UserIcon size={20} />
            Enter the Grid
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="h-screen w-screen bg-[#050505] overflow-hidden relative font-sans text-white">
      {/* HUD: Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 p-6 flex justify-between items-start pointer-events-none">
        <div className="flex flex-col gap-4 pointer-events-auto">
          <div className="bg-black/80 backdrop-blur-xl border border-white/10 p-4 rounded-2xl flex items-center gap-4 shadow-xl">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Trophy size={20} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Harmony Level</div>
              <div className="text-xl font-mono font-bold text-cyan-400">{profile?.harmonyPoints || 0} HP</div>
            </div>
          </div>

          <div className="bg-black/80 backdrop-blur-xl border border-white/10 p-4 rounded-2xl flex items-center gap-4 shadow-xl">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
              <Star size={20} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Level {profile?.level || 1}</div>
              <div className="w-32 h-1.5 bg-white/10 rounded-full mt-1 overflow-hidden">
                <div 
                  className="h-full bg-purple-500 transition-all duration-500" 
                  style={{ width: `${((profile?.xp || 0) / ((profile?.level || 1) * 100)) * 100}%` }}
                />
              </div>
            </div>
          </div>
          
          {/* Undo/Redo */}
          <div className="flex gap-2">
            <button 
              onClick={handleUndo}
              disabled={history.length === 0}
              className="w-10 h-10 bg-black/80 border border-white/10 rounded-xl flex items-center justify-center hover:bg-white/10 disabled:opacity-30 transition-all"
            >
              <Undo2 size={18} />
            </button>
            <button 
              onClick={handleRedo}
              disabled={future.length === 0}
              className="w-10 h-10 bg-black/80 border border-white/10 rounded-xl flex items-center justify-center hover:bg-white/10 disabled:opacity-30 transition-all"
            >
              <Redo2 size={18} />
            </button>
          </div>
        </div>

        <div className="flex gap-4 pointer-events-auto">
          {!isAudioStarted && (
            <button 
              onClick={handleStartAudio}
              className="px-6 py-3 bg-cyan-500 text-black font-bold rounded-xl flex items-center gap-2 hover:bg-cyan-400 transition-all shadow-lg shadow-cyan-500/20 active:scale-95"
            >
              <Zap size={18} />
              Initialize Audio
            </button>
          )}
          <button 
            onClick={() => setShowInfo(!showInfo)}
            className="w-12 h-12 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center hover:bg-white/10 transition-all"
          >
            <Info size={20} />
          </button>
          <button 
            onClick={logout}
            className="w-12 h-12 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center hover:bg-red-500/20 hover:border-red-500/50 transition-all"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>

      {/* HUD: Left Tool Bar */}
      <div className="absolute left-6 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-3 p-2 bg-black/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl">
        <button 
          onClick={() => setActiveTool('select')}
          className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${activeTool === 'select' ? 'bg-white text-black' : 'text-gray-400 hover:bg-white/5'}`}
        >
          <MousePointer2 size={20} />
        </button>
        <button 
          onClick={() => setActiveTool('place')}
          className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${activeTool === 'place' ? 'bg-white text-black' : 'text-gray-400 hover:bg-white/5'}`}
        >
          <Plus size={20} />
        </button>
        <button 
          onClick={() => setActiveTool('delete')}
          className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${activeTool === 'delete' ? 'bg-white text-black' : 'text-gray-400 hover:bg-white/5'}`}
        >
          <Trash2 size={20} />
        </button>
        <button 
          onClick={() => setActiveTool('road')}
          className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${activeTool === 'road' ? 'bg-white text-black' : 'text-gray-400 hover:bg-white/5'}`}
        >
          <Route size={20} />
        </button>
      </div>

      {/* HUD: Bottom Bar (Building Selector) */}
      <AnimatePresence>
        {activeTool === 'place' && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex gap-4 p-2 bg-black/80 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl"
          >
            {getUnlockedBuildings(profile?.level || 1).map(type => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`px-6 py-4 rounded-2xl flex flex-col items-center gap-2 transition-all ${
                  selectedType === type 
                    ? 'bg-white text-black shadow-lg' 
                    : 'text-gray-400 hover:bg-white/5'
                }`}
              >
                <div className="relative">
                  <Building2 size={24} />
                  {type === 'global_fx' && <Zap size={12} className="absolute -top-1 -right-1 text-orange-500" />}
                </div>
                <span className="text-[10px] uppercase font-bold tracking-widest">{type.replace('_', ' ')}</span>
                <span className="text-[9px] opacity-50">50 HP</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Properties Panel */}
      <AnimatePresence>
        {selectedId && selectedBuilding && (
          <motion.div 
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            className="absolute right-6 top-1/2 -translate-y-1/2 z-30 w-80 bg-black/90 backdrop-blur-3xl border border-white/10 rounded-3xl shadow-2xl p-6 space-y-8"
          >
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Settings2 size={20} className="text-cyan-400" />
                Building Config
              </h3>
              <button onClick={() => setSelectedId(null)} className="text-gray-500 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6">
              {/* Upgrade Section */}
              <div className="p-4 bg-white/5 rounded-2xl border border-white/10 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-purple-400 flex items-center gap-2">
                    <ArrowUpCircle size={14} /> Lvl {selectedBuilding.level}
                  </span>
                  <span className="text-[10px] text-gray-500">{selectedBuilding.level * 200} HP to Upgrade</span>
                </div>
                <button 
                  onClick={handleUpgrade}
                  disabled={profile.harmonyPoints < selectedBuilding.level * 200}
                  className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-30 text-white text-xs font-bold rounded-lg transition-all"
                >
                  Upgrade Building
                </button>
              </div>

              {/* Note Selection */}
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold flex items-center gap-2">
                  <Music2 size={12} /> Root Note
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {NOTES.map(n => (
                    <button
                      key={n}
                      onClick={() => updateBuildingParam(selectedId, { note: n })}
                      className={`py-2 rounded-lg text-xs font-mono transition-all ${selectedBuilding.params.note === n ? 'bg-cyan-500 text-black font-bold' : 'bg-white/5 hover:bg-white/10'}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Waveform */}
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold flex items-center gap-2">
                  <Waves size={12} /> Waveform
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {WAVES.map(w => (
                    <button
                      key={w}
                      onClick={() => updateBuildingParam(selectedId, { waveType: w })}
                      className={`py-2 rounded-lg text-xs capitalize transition-all ${selectedBuilding.params.waveType === w ? 'bg-purple-500 text-white font-bold' : 'bg-white/5 hover:bg-white/10'}`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              {/* Volume */}
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold flex items-center gap-2">
                  <Volume2 size={12} /> Volume
                </label>
                <input 
                  type="range" 
                  min="-60" 
                  max="0" 
                  value={selectedBuilding.params.volume || -20}
                  onChange={(e) => updateBuildingParam(selectedId, { volume: parseInt(e.target.value) })}
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>

              {/* Global FX Controls */}
              {selectedBuilding.type === 'global_fx' && (
                <>
                  <div className="space-y-3">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Master Reverb</label>
                    <input 
                      type="range" min="0" max="1" step="0.01"
                      value={selectedBuilding.params.reverb || 0.3}
                      onChange={(e) => updateBuildingParam(selectedId, { reverb: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-orange-400"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Master Delay</label>
                    <input 
                      type="range" min="0" max="1" step="0.01"
                      value={selectedBuilding.params.delay || 0.3}
                      onChange={(e) => updateBuildingParam(selectedId, { delay: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-orange-400"
                    />
                  </div>
                </>
              )}

              {/* Sequencer Pattern */}
              {selectedBuilding.type === 'sequencer' && (
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Step Pattern</label>
                  <div className="flex gap-2">
                    {(selectedBuilding.params.pattern || [0,0,0,0]).map((step, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          const newPattern = [...(selectedBuilding.params.pattern || [0,0,0,0])];
                          newPattern[i] = step ? 0 : 1;
                          updateBuildingParam(selectedId, { pattern: newPattern });
                        }}
                        className={`flex-1 h-10 rounded-lg transition-all ${step ? 'bg-cyan-400 shadow-lg shadow-cyan-400/20' : 'bg-white/5'}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-top border-white/5">
              <div className="text-[10px] text-gray-600">Owner: {selectedBuilding.ownerName}</div>
              <div className="text-[10px] text-gray-600">ID: {selectedBuilding.id}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The Grid */}
      <Stage
        width={window.innerWidth}
        height={window.innerHeight}
        onClick={handleStageClick}
        onWheel={handleWheel}
        draggable={activeTool === 'select'}
        onDragEnd={(e) => setCamera({ ...camera, x: e.target.x(), y: e.target.y() })}
        x={camera.x}
        y={camera.y}
        scaleX={camera.scale}
        scaleY={camera.scale}
      >
        <Layer>
          {/* Grid Lines */}
          {Array.from({ length: 160 }).map((_, i) => (
            <React.Fragment key={i}>
              <Line
                points={[(i - 80) * GRID_SIZE, -WORLD_SIZE, (i - 80) * GRID_SIZE, WORLD_SIZE]}
                stroke="rgba(255,255,255,0.03)"
                strokeWidth={1}
              />
              <Line
                points={[-WORLD_SIZE, (i - 80) * GRID_SIZE, WORLD_SIZE, (i - 80) * GRID_SIZE]}
                stroke="rgba(255,255,255,0.03)"
                strokeWidth={1}
              />
            </React.Fragment>
          ))}

          {/* Buildings */}
          {buildings.map(b => (
            <Group 
              key={b.id} 
              x={b.x} 
              y={b.y} 
              onClick={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  setSelectedId(b.id);
                }
              }}
            >
              {/* Glow Effect */}
              <Rect
                width={GRID_SIZE - 4}
                height={GRID_SIZE - 4}
                fill={b.color || '#333'}
                cornerRadius={12}
                shadowBlur={20 + (Math.max(0, meterValue + 60) / 2)}
                shadowColor={b.color || '#333'}
                shadowOpacity={selectedId === b.id ? 0.8 : 0.3}
                opacity={b.type === 'road' ? 0.3 : 0.6 + (Math.max(0, meterValue + 60) / 100)}
              />
              {/* Main Body */}
              <Rect
                width={GRID_SIZE - 4}
                height={GRID_SIZE - 4}
                fill={selectedId === b.id ? 'white' : b.color || '#333'}
                cornerRadius={b.type === 'road' ? 0 : 12}
                opacity={b.type === 'road' ? 0.5 : 0.9}
                stroke={selectedId === b.id ? '#00f2ff' : 'transparent'}
                strokeWidth={2}
              />
              {/* Active Indicator */}
              {selectedId === b.id && b.type !== 'road' && (
                <Circle 
                  x={GRID_SIZE / 2 - 2}
                  y={GRID_SIZE / 2 - 2}
                  radius={8 + Math.sin(Date.now() / 200) * 2}
                  stroke="#00f2ff"
                  strokeWidth={1}
                  opacity={0.5}
                />
              )}
              {/* Detail */}
              <Rect
                width={GRID_SIZE - 12}
                height={GRID_SIZE - 12}
                x={4}
                y={4}
                stroke="white"
                strokeWidth={1}
                opacity={0.2}
                cornerRadius={8}
              />
              {/* Type Icon Indicator */}
              <Circle 
                x={GRID_SIZE / 2 - 2}
                y={GRID_SIZE / 2 - 2}
                radius={4}
                fill="white"
                opacity={0.5}
              />
            </Group>
          ))}
        </Layer>
      </Stage>

      {/* Visualizer Overlay */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="h-full w-full bg-[radial-gradient(circle_at_50%_50%,rgba(0,242,255,0.05)_0%,transparent_70%)]" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent opacity-50" />
      </div>
    </div>
    </ErrorBoundary>
  );
}
