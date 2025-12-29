import React, { createContext, useContext, useState } from "react";

type Coord = {
  latitude: number;
  longitude: number;
};

type RouteInfo = {
  duration: string;
  distance: string;
};

export type NavigationContextType = {
  // Coordinate della route (linea da disegnare sulla mappa)
  routeCoords: Coord[];
  setRouteCoords: (coords: Coord[]) => void;

  // Posizione GPS attuale
  currentPosition: Coord | null;
  setCurrentPosition: (pos: Coord) => void;

  // Info route (durata, km)
  routeInfo: RouteInfo;
  setRouteInfo: (info: RouteInfo) => void;

  // Istruzione attuale (manovra)
  currentInstruction: any;
  setCurrentInstruction: (i: any) => void;
};

const NavigationContext = createContext<NavigationContextType | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [routeCoords, setRouteCoords] = useState<Coord[]>([]);
  const [currentPosition, setCurrentPosition] = useState<Coord | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo>({ duration: "", distance: "" });
  const [currentInstruction, setCurrentInstruction] = useState<any>(null);

  return (
    <NavigationContext.Provider
      value={{
        routeCoords,
        setRouteCoords,
        currentPosition,
        setCurrentPosition,
        routeInfo,
        setRouteInfo,
        currentInstruction,
        setCurrentInstruction,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigationContext() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("NavigationContext non trovato");
  return ctx;
}
