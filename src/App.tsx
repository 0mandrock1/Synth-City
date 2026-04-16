import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Stage, Layer, Rect, Text, Group, Line, Circle } from 'react-konva';
import { auth, db, loginWithGoogle, logout } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, query, where, getDoc, writeBatch } from 'firebase/firestore';
import { BuildingData, UserProfile, BuildingType, WaveType } from './types';
import { BUILDING_CONFIGS } from './buildingConfigs';
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
  const [hoveredBuilding, setHoveredBuilding] = useState<BuildingData | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [frequencyData, setFrequencyData] = useState<Uint8Array>(new Uint8Array(0));
  
  // Undo/Redo stacks
  const [history, setHistory] = useState<HistoryAction[]>([]);
  const [future, setFuture] = useState<HistoryAction[]>([]);

  const [confirmDemolish, setConfirmDemolish] = useState(false);

  // Auth & Profile Listener
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setProfile(null);
        return;
      }

      // Initial fetch/migration
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
        }
      } catch (err) {
        console.error(err);
      }

      // Real-time listener for profile
      const unsubProfile = onSnapshot(userRef, (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
        }
      });

      return () => unsubProfile();
    });
    return unsubAuth;
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
    const analyser = audioEngine.getAnalyser();
    const bufferLength = analyser.size;
    const dataArray = new Uint8Array(bufferLength);

    const loop = () => {
      setMeterValue(audioEngine.getMeterValue() as number);
      const values = analyser.getValue() as unknown as Float32Array;
      // Convert Float32Array (-100 to 0 dB approx) to 0-255 for visualizer
      const uint8 = new Uint8Array(values.length);
      for (let i = 0; i < values.length; i++) {
        uint8[i] = Math.max(0, Math.min(255, (values[i] + 100) * 2.55));
      }
      setFrequencyData(uint8);
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [isAudioStarted]);

  // Harmony Points & XP Generator
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      // Get latest profile from Firestore to avoid stale state issues
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) return;
      const currentProfile = snap.data() as UserProfile;

      const userBuildings = buildings.filter(b => b.ownerId === user.uid && b.type !== 'road');
      const roads = buildings.filter(b => b.type === 'road');

      if (userBuildings.length > 0) {
        let totalPoints = 0;
        let totalXp = 0;

        userBuildings.forEach(b => {
          let basePoints = 5 * b.level;
          let baseXp = 2;

          // Road Bonus: Check if adjacent to any road
          const isNearRoad = roads.some(r => 
            Math.abs(r.x - b.x) <= GRID_SIZE && Math.abs(r.y - b.y) <= GRID_SIZE
          );

          if (isNearRoad) {
            basePoints = Math.floor(basePoints * 1.5);
            baseXp += 1;
          }

          totalPoints += basePoints;
          totalXp += baseXp;
        });
        
        let newXp = (currentProfile.xp ?? 0) + totalXp;
        let newLevel = currentProfile.level ?? 1;
        const xpToNext = newLevel * 100;
        
        if (newXp >= xpToNext) {
          newXp -= xpToNext;
          newLevel += 1;
        }

        try {
          await updateDoc(userRef, {
            harmonyPoints: (currentProfile.harmonyPoints ?? 0) + totalPoints,
            xp: newXp,
            level: newLevel
          });
        } catch (err) {
          console.error("HP/XP update failed", err);
        }
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [user, buildings]);

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
        const data = { ...action.data, level: action.data.level ?? 1 };
        await setDoc(doc(db, 'buildings', action.data.id), data);
      } else if (action.type === 'update' && action.prevData) {
        const data = { ...action.prevData, level: action.prevData.level ?? 1 };
        await setDoc(doc(db, 'buildings', action.data.id), data);
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
        const data = { ...action.data, level: action.data.level ?? 1 };
        await setDoc(doc(db, 'buildings', action.data.id), data);
      } else if (action.type === 'delete') {
        await deleteDoc(doc(db, 'buildings', action.data.id));
      } else if (action.type === 'update') {
        const data = { ...action.data, level: action.data.level ?? 1 };
        await setDoc(doc(db, 'buildings', action.data.id), data);
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
      const type = activeTool === 'road' ? 'road' : selectedType;
      const config = BUILDING_CONFIGS[type];
      const cost = config.cost;
      if (profile.harmonyPoints < cost) return;

      const newBuilding: BuildingData = {
        id: Math.random().toString(36).substr(2, 9),
        ownerId: user.uid,
        ownerName: user.displayName || 'Unknown',
        type: type,
        x: gridX,
        y: gridY,
        color: config.color,
        params: {
          ...config.defaultParams,
          note: NOTES[Math.abs(gridX + gridY) % NOTES.length],
        },
        level: 1,
        createdAt: new Date().toISOString()
      };

      pushToHistory({ type: 'place', data: newBuilding });
      await setDoc(doc(db, 'buildings', newBuilding.id), newBuilding);
      await updateDoc(doc(db, 'users', user.uid), {
        harmonyPoints: (profile.harmonyPoints ?? 0) - cost
      });
    }
  };

  const updateBuildingParam = async (id: string, updates: Partial<BuildingData['params']>) => {
    if (!user) return;
    const b = buildings.find(b => b.id === id);
    if (!b || b.ownerId !== user.uid) return;

    const newData = { ...b, params: { ...b.params, ...updates }, level: b.level ?? 1 };
    pushToHistory({ type: 'update', data: newData, prevData: b });
    await updateDoc(doc(db, 'buildings', id), { 
      params: newData.params,
      level: newData.level 
    });
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
      harmonyPoints: (profile.harmonyPoints ?? 0) - upgradeCost
    });
  };

  const getUnlockedBuildings = (level: number): BuildingType[] => {
    return (Object.keys(BUILDING_CONFIGS) as BuildingType[])
      .filter(type => type !== 'road' && BUILDING_CONFIGS[type].unlockLevel <= level)
      .sort((a, b) => BUILDING_CONFIGS[a].unlockLevel - BUILDING_CONFIGS[b].unlockLevel);
  };

  const handleStageContextMenu = (e: any) => {
    e.evt.preventDefault();
    if (!user) return;

    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();
    const worldX = (pointer.x - camera.x) / camera.scale;
    const worldY = (pointer.y - camera.y) / camera.scale;
    const gridX = Math.floor(worldX / GRID_SIZE) * GRID_SIZE;
    const gridY = Math.floor(worldY / GRID_SIZE) * GRID_SIZE;

    const clickedBuilding = buildings.find(b => b.x === gridX && b.y === gridY);
    if (clickedBuilding) {
      setSelectedId(clickedBuilding.id);
      setActiveTool('select');
    }
  };

  const handleDebugMode = async () => {
    if (!user || user.email !== '0mandrock1@gmail.com') return;
    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, {
      harmonyPoints: 99999,
      level: 20,
      xp: 0
    });
  };

  const handleResetProgress = async () => {
    if (!user || user.email !== '0mandrock1@gmail.com') return;
    
    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, {
      harmonyPoints: 500,
      level: 1,
      xp: 0
    });

    // Delete all user buildings
    const userBuildings = buildings.filter(b => b.ownerId === user.uid);
    const batch = writeBatch(db);
    userBuildings.forEach(b => {
      batch.delete(doc(db, 'buildings', b.id));
    });
    await batch.commit();
    window.location.reload();
  };

  const handleDeleteAll = async () => {
    if (!user || user.email !== '0mandrock1@gmail.com') return;
    if (!confirm("DELETE ALL BUILDINGS ON THE MAP?")) return;
    
    const batch = writeBatch(db);
    buildings.forEach(b => {
      batch.delete(doc(db, 'buildings', b.id));
    });
    await batch.commit();
  };

  const handleDemolish = async () => {
    if (!selectedBuilding || !user) return;
    if (selectedBuilding.ownerId !== user.uid) return;
    
    if (!confirmDemolish) {
      setConfirmDemolish(true);
      setTimeout(() => setConfirmDemolish(false), 3000);
      return;
    }

    pushToHistory({ type: 'delete', data: selectedBuilding });
    await deleteDoc(doc(db, 'buildings', selectedBuilding.id));
    setSelectedId(null);
    setConfirmDemolish(false);
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
          {user?.email === '0mandrock1@gmail.com' && (
            <div className="flex gap-2">
              <button 
                onClick={handleDebugMode}
                className="px-4 h-12 bg-yellow-500 text-black font-bold rounded-xl flex items-center gap-2 hover:bg-yellow-400 transition-all shadow-lg shadow-yellow-500/20"
              >
                <Activity size={18} />
                DEBUG
              </button>
              <button 
                onClick={handleResetProgress}
                className="px-4 h-12 bg-red-600 text-white font-bold rounded-xl flex items-center gap-2 hover:bg-red-500 transition-all shadow-lg shadow-red-600/20"
                title="Reset User Progress"
              >
                <Trash2 size={18} />
                RESET
              </button>
              <button 
                onClick={handleDeleteAll}
                className="px-4 h-12 bg-orange-600 text-white font-bold rounded-xl flex items-center gap-2 hover:bg-orange-500 transition-all shadow-lg shadow-orange-600/20"
                title="Delete All Map Buildings"
              >
                <X size={18} />
                WIPE MAP
              </button>
            </div>
          )}
        </div>
      </div>

      {/* HUD: Left Tool Bar */}
      <div className="absolute left-6 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-3 p-2 bg-[#151619]/90 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl">
        <button 
          onClick={() => setActiveTool('select')}
          className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${activeTool === 'select' ? 'bg-cyan-500 text-black' : 'text-gray-400 hover:bg-white/5'}`}
        >
          <MousePointer2 size={20} />
        </button>
        <button 
          onClick={() => setActiveTool('place')}
          className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${activeTool === 'place' ? 'bg-cyan-500 text-black' : 'text-gray-400 hover:bg-white/5'}`}
        >
          <Plus size={20} />
        </button>
        <button 
          onClick={() => setActiveTool('road')}
          className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${activeTool === 'road' ? 'bg-cyan-500 text-black' : 'text-gray-400 hover:bg-white/5'}`}
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
            {getUnlockedBuildings(profile?.level || 1).map(type => {
              const config = BUILDING_CONFIGS[type];
              return (
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
                  <span className="text-[10px] uppercase font-bold tracking-widest">{config.name}</span>
                  <span className="text-[9px] opacity-50">{config.cost} HP</span>
                </button>
              );
            })}
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
            className="absolute right-6 top-1/2 -translate-y-1/2 z-30 w-80 bg-[#151619]/95 backdrop-blur-3xl border border-white/10 rounded-3xl shadow-2xl p-6 flex flex-col gap-6"
          >
            <div className="flex justify-between items-center border-b border-white/5 pb-4">
              <div className="space-y-1">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <Settings2 size={20} className="text-cyan-400" />
                  {BUILDING_CONFIGS[selectedBuilding.type].name}
                </h3>
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  {BUILDING_CONFIGS[selectedBuilding.type].description}
                </p>
                <div className="text-[10px] font-mono text-gray-500 tracking-widest uppercase">Hardware ID: {selectedBuilding.id.slice(0, 8)}</div>
              </div>
              <button onClick={() => setSelectedId(null)} className="w-8 h-8 bg-white/5 rounded-full flex items-center justify-center text-gray-500 hover:text-white transition-all">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 space-y-6 custom-scrollbar">
              {/* Upgrade Section */}
              {selectedBuilding.ownerId === user.uid && (
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-purple-400 flex items-center gap-2">
                      <ArrowUpCircle size={14} /> LEVEL {selectedBuilding.level}
                    </span>
                    <span className="text-[10px] font-mono text-gray-500">{selectedBuilding.level * 200} HP</span>
                  </div>
                  <button 
                    onClick={handleUpgrade}
                    disabled={profile.harmonyPoints < selectedBuilding.level * 200}
                    className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-30 text-white text-xs font-bold rounded-lg transition-all"
                  >
                    UPGRADE UNIT
                  </button>
                </div>
              )}

              {/* Note Selection - Only for sound producers */}
              {(['oscillator', 'sequencer', 'arpeggiator'].includes(selectedBuilding.type)) && (
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold flex items-center gap-2">
                    <Music2 size={12} /> FREQUENCY
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {NOTES.map(n => (
                      <button
                        key={n}
                        onClick={() => updateBuildingParam(selectedId, { note: n })}
                        className={`py-2 rounded-lg text-xs font-mono transition-all border ${selectedBuilding.params.note === n ? 'bg-cyan-500 border-cyan-400 text-black font-bold' : 'bg-white/5 border-transparent hover:bg-white/10'}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Waveform Selection */}
              {(['oscillator', 'sequencer', 'arpeggiator'].includes(selectedBuilding.type)) && (
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold flex items-center gap-2">
                    <Waves size={12} /> WAVEFORM
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {WAVES.map(w => (
                      <button
                        key={w}
                        onClick={() => updateBuildingParam(selectedId, { waveType: w })}
                        className={`py-2 px-3 rounded-lg text-[10px] uppercase font-bold tracking-widest transition-all border ${selectedBuilding.params.waveType === w ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Volume */}
              {(['oscillator', 'sequencer', 'arpeggiator', 'sampler'].includes(selectedBuilding.type)) && (
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold flex items-center gap-2">
                    <Volume2 size={12} /> GAIN
                  </label>
                  <div className="flex items-center gap-4">
                    <input 
                      type="range" min="-60" max="0"
                      value={selectedBuilding.params.volume || -20}
                      onChange={(e) => updateBuildingParam(selectedId, { volume: parseInt(e.target.value) })}
                      className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                    <span className="text-xs font-mono text-cyan-400">{selectedBuilding.params.volume || -20}dB</span>
                  </div>
                </div>
              )}

              {/* Sampler Sample Selection */}
              {selectedBuilding.type === 'sampler' && (
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold flex items-center gap-2">
                    <Music size={12} /> SELECT SAMPLE
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { name: 'Kick', url: 'https://tonejs.github.io/audio/drum-samples/kick.mp3' },
                      { name: 'Snare', url: 'https://tonejs.github.io/audio/drum-samples/snare.mp3' },
                      { name: 'HiHat', url: 'https://tonejs.github.io/audio/drum-samples/hihat.mp3' },
                      { name: 'Clap', url: 'https://tonejs.github.io/audio/drum-samples/clap.mp3' },
                      { name: 'Cowbell', url: 'https://tonejs.github.io/audio/drum-samples/cowbell.mp3' },
                      { name: 'Tom', url: 'https://tonejs.github.io/audio/drum-samples/tom.mp3' },
                    ].map(s => (
                      <button
                        key={s.name}
                        onClick={() => updateBuildingParam(selectedId, { sample: s.url })}
                        className={`py-2 px-3 rounded-lg text-[10px] uppercase font-bold tracking-widest transition-all border ${selectedBuilding.params.sample === s.url ? 'bg-purple-500 text-white border-purple-400' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                  <div className="pt-2">
                    <label className="text-[9px] text-gray-600 uppercase block mb-1">Custom URL</label>
                    <input 
                      type="text"
                      placeholder="https://..."
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-cyan-400 focus:outline-none focus:border-cyan-500/50"
                      onBlur={(e) => {
                        if (e.target.value) updateBuildingParam(selectedId, { sample: e.target.value });
                      }}
                      defaultValue={selectedBuilding.params.sample || ''}
                    />
                  </div>
                </div>
              )}

              {/* Arpeggiator Rate */}
              {selectedBuilding.type === 'arpeggiator' && (
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold flex items-center gap-2">
                    <Activity size={12} /> ARP RATE
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {['4n', '8n', '16n'].map(r => (
                      <button
                        key={r}
                        onClick={() => updateBuildingParam(selectedId, { rate: r })}
                        className={`py-2 rounded-lg text-[10px] font-bold transition-all border ${selectedBuilding.params.rate === r ? 'bg-yellow-500 border-yellow-400 text-black' : 'bg-white/5 border-transparent hover:bg-white/10'}`}
                      >
                        {r === '4n' ? '1/4' : r === '8n' ? '1/8' : '1/16'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* FX Unit Specifics */}
              {selectedBuilding.type === 'fx' && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">REVERB MIX</label>
                    <input 
                      type="range" min="0" max="1" step="0.01"
                      value={selectedBuilding.params.reverb || 0.4}
                      onChange={(e) => updateBuildingParam(selectedId, { reverb: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">DELAY MIX</label>
                    <input 
                      type="range" min="0" max="1" step="0.01"
                      value={selectedBuilding.params.delay || 0.4}
                      onChange={(e) => updateBuildingParam(selectedId, { delay: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                  </div>
                </div>
              )}

              {/* Power Plant Info */}
              {selectedBuilding.type === 'power_plant' && (
                <div className="p-4 bg-green-500/5 rounded-2xl border border-green-500/20 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest">Grid Output</span>
                    <span className="text-xs font-mono text-green-400">+{selectedBuilding.params.powerOutput || 100}W</span>
                  </div>
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 w-3/4 animate-pulse" />
                  </div>
                </div>
              )}

              {/* Master Clock Info */}
              {selectedBuilding.type === 'master_clock' && (
                <div className="p-4 bg-purple-500/5 rounded-2xl border border-purple-500/20 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">Sync Signal</span>
                    <span className="text-xs font-mono text-purple-400">ACTIVE</span>
                  </div>
                  <div className="flex gap-1">
                    {[1,2,3,4].map(i => (
                      <div key={i} className="flex-1 h-1 bg-purple-500/30 rounded-full overflow-hidden">
                        <motion.div 
                          animate={{ opacity: [0.2, 1, 0.2] }}
                          transition={{ duration: 1, repeat: Infinity, delay: i * 0.25 }}
                          className="h-full bg-purple-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Radius Control */}
              {(['fx', 'power_plant', 'master_clock'].includes(selectedBuilding.type)) && (
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold flex items-center gap-2">
                    <Activity size={12} /> EFFECT RADIUS
                  </label>
                  <div className="flex items-center gap-4">
                    <input 
                      type="range" min="100" max="1000" step="10"
                      value={selectedBuilding.params.radius || 250}
                      onChange={(e) => updateBuildingParam(selectedId, { radius: parseInt(e.target.value) })}
                      className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                    <span className="text-xs font-mono text-cyan-400">{selectedBuilding.params.radius || 250}px</span>
                  </div>
                </div>
              )}

              {/* Global FX Controls */}
              {selectedBuilding.type === 'global_fx' && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">MASTER REVERB</label>
                    <input 
                      type="range" min="0" max="1" step="0.01"
                      value={selectedBuilding.params.reverb || 0.3}
                      onChange={(e) => updateBuildingParam(selectedId, { reverb: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-orange-400"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">MASTER DELAY</label>
                    <input 
                      type="range" min="0" max="1" step="0.01"
                      value={selectedBuilding.params.delay || 0.3}
                      onChange={(e) => updateBuildingParam(selectedId, { delay: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-orange-400"
                    />
                  </div>
                </div>
              )}

              {/* Sequencer Pattern */}
              {selectedBuilding.type === 'sequencer' && (
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">STEP SEQUENCER</label>
                  <div className="flex gap-2">
                    {(selectedBuilding.params.pattern || [0,0,0,0]).map((step, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          const newPattern = [...(selectedBuilding.params.pattern || [0,0,0,0])];
                          newPattern[i] = step ? 0 : 1;
                          updateBuildingParam(selectedId, { pattern: newPattern });
                        }}
                        className={`flex-1 h-12 rounded-lg transition-all border ${step ? 'bg-cyan-400 border-cyan-300 shadow-lg shadow-cyan-400/20' : 'bg-white/5 border-white/10'}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-white/5 space-y-4">
              <div className="flex justify-between text-[10px] font-mono text-gray-600 uppercase tracking-widest">
                <span>Owner: {selectedBuilding.ownerName}</span>
                <span>Lvl: {selectedBuilding.level}</span>
              </div>
              {selectedBuilding.ownerId === user.uid && (
                <button 
                  onClick={handleDemolish}
                  className={`w-full py-3 border text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl transition-all flex items-center justify-center gap-2 ${
                    confirmDemolish 
                      ? 'bg-red-600 border-red-500 text-white animate-pulse' 
                      : 'bg-red-500/10 hover:bg-red-500/20 border-red-500/30 text-red-500'
                  }`}
                >
                  <Trash2 size={14} />
                  {confirmDemolish ? 'Click to Confirm' : 'Demolish Unit'}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The Grid */}
      <Stage
        width={window.innerWidth}
        height={window.innerHeight}
        onClick={handleStageClick}
        onContextMenu={handleStageContextMenu}
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
              onMouseEnter={(e) => {
                setHoveredBuilding(b);
                const stage = e.target.getStage();
                const pointer = stage.getPointerPosition();
                setTooltipPos(pointer);
              }}
              onMouseMove={(e) => {
                const stage = e.target.getStage();
                const pointer = stage.getPointerPosition();
                setTooltipPos(pointer);
              }}
              onMouseLeave={() => setHoveredBuilding(null)}
            >
              {/* Radius Visualization */}
              {selectedId === b.id && (b.params.radius ?? 0) > 0 && (
                <Circle
                  x={GRID_SIZE / 2 - 2}
                  y={GRID_SIZE / 2 - 2}
                  radius={b.params.radius}
                  stroke={b.color || '#333'}
                  strokeWidth={1}
                  dash={[5, 5]}
                  opacity={0.3}
                />
              )}
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
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div 
          animate={{ 
            opacity: [0.05, 0.1 + (Math.max(0, meterValue + 60) / 100), 0.05],
            scale: [1, 1.05 + (Math.max(0, meterValue + 60) / 200), 1]
          }}
          transition={{ duration: 0.1, ease: "linear" }}
          className="h-full w-full bg-[radial-gradient(circle_at_50%_50%,rgba(0,242,255,0.15)_0%,transparent_70%)]" 
        />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent opacity-50" />
      </div>

      {/* Building Tooltip */}
      <AnimatePresence>
        {hoveredBuilding && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            style={{ 
              left: tooltipPos.x + 20, 
              top: tooltipPos.y + 20,
              position: 'absolute'
            }}
            className="z-[100] pointer-events-none bg-[#1a1b1e]/95 backdrop-blur-xl border border-white/10 p-3 rounded-xl shadow-2xl min-w-[160px]"
          >
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: hoveredBuilding.color }} />
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                {BUILDING_CONFIGS[hoveredBuilding.type].name}
              </span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500">LEVEL</span>
                <span className="text-cyan-400 font-mono">{hoveredBuilding.level}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500">OWNER</span>
                <span className="text-white truncate max-w-[80px]">{hoveredBuilding.ownerName || 'Unknown'}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Corner Frequency Visualizer */}
      <div className="absolute bottom-6 left-6 z-20 p-4 bg-black/40 backdrop-blur-md border border-white/5 rounded-2xl pointer-events-none">
        <div className="flex items-end gap-[2px] h-12 w-48">
          {Array.from({ length: 32 }).map((_, i) => {
            const val = frequencyData[i * 4] || 0;
            const height = (val / 255) * 100;
            return (
              <motion.div
                key={i}
                animate={{ height: `${Math.max(10, height)}%` }}
                transition={{ type: "spring", bounce: 0, duration: 0.1 }}
                className="flex-1 bg-gradient-to-t from-cyan-500/20 to-cyan-400 rounded-t-sm"
              />
            );
          })}
        </div>
        <div className="mt-2 text-[8px] font-mono text-cyan-500/50 uppercase tracking-[0.2em] flex justify-between">
          <span>20Hz</span>
          <span>Spectrum Analysis</span>
          <span>20kHz</span>
        </div>
      </div>
    </div>
    </ErrorBoundary>
  );
}
