import { useContext } from 'react';
import { SocketContext } from './socket';

export default function useSocket() {
	return useContext(SocketContext);
}
