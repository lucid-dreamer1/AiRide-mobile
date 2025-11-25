import { useAuthContext } from "./AuthContext";

export const useAuth = () => {
  const { user, userData, loading, logout } = useAuthContext();
  return { user, userData, loading, logout };
};
