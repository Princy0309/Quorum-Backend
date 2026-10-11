import { Server } from 'socket.io';
import { registerSfuSignaling } from './sfuSignaling.js';
import { handleJoinMeeting, handleLeaveMeeting, handleEndMeeting, handleDisconnectCleanup } from './meetingPresence.js';
import { handleToggleMic, handleToggleCam, handleMuteParticipant, handleSendMeetingMessage } from './meetingControls.js';
import { handleAdmitParticipant, handleRejectParticipant } from './waitingRoom.js';
import logger from '../utils/logger.js';
import { verifyAccessToken } from '../services/tokenService.js';

let ioInstance: Server | null = null;

export const getIO = (): Server => {
  if (!ioInstance) {
    throw new Error('Socket.IO has not been initialized');
  }
  return ioInstance;
};

export const initSocketServer = (httpServer: any) => {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      credentials: true,
    },
  });

  ioInstance = io;

    io.use((socket, next) => {
      const auth = socket.handshake.auth || {};
      let userId : string | null = null;
      let name: string = auth.name || 'Participant';

      const token = auth.token || socket.handshake.headers.authorization?.replace('Bearer', '');
      if(token){
        try{
          const decoded = verifyAccessToken(token);
          if(decoded?.id){
            userId = decoded.id;
          }
        }catch(err){
          logger.debug(`[Socket] Handshake token verification failed: ${err}`);
        }
      }
        if(!userId && auth.userId){
          userId = String(auth.userId);
        }

        socket.data.user = {
          id: String(userId || socket.id),
          name: String(name)
        };
      
      next();
    });

  io.on('connection', (socket) => {
    logger.info(`[Socket] Client connected: ${socket.id}`);

    
    registerSfuSignaling(io, socket);

    
    socket.on('meeting:join', (data, ack) => handleJoinMeeting(io, socket, data.meetingCode, ack));
    socket.on('meeting:leave', (data, ack) => handleLeaveMeeting(io, socket, data.meetingCode, ack));
    socket.on('meeting:end', (data, ack) => handleEndMeeting(io, socket, data, ack));

    
    socket.on('meeting:toggle-mic', (data, ack) => handleToggleMic(io, socket, data, ack));
    socket.on('meeting:toggle-cam', (data, ack) => handleToggleCam(io, socket, data, ack));
    socket.on('meeting:mute-participant', (data, ack) => handleMuteParticipant(io, socket, data, ack));
    socket.on('meeting:send-message', (data, ack) => handleSendMeetingMessage(io, socket, data, ack));

    
    socket.on('meeting:admit-participant', (data, ack) => handleAdmitParticipant(io, socket, data, ack));
    socket.on('meeting:reject-participant', (data, ack) => handleRejectParticipant(io, socket, data, ack));

    socket.on('disconnect', () => {
      logger.info(`[Socket] Client disconnected: ${socket.id}`);
      handleDisconnectCleanup(io, socket);
    });
  });

  return io;
};
