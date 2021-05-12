import express from "express";
import fs from "fs";
import path from "path";
// @ts-ignore
import spdy from "spdy";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import WebSocket from "ws";
import logger from "../logger";
import GrpcParser from "../parser/GrpcParser";
import { IncomingMessage } from "http";
import WebsocketParser from "../parser/WebsocketParser";
// @ts-ignore
import { v4 as uuidv4 } from "uuid";
const clients: string[] = [];
/**
 * Defines all protocols:
 * Currently active:
 *    http, https, grpc
 * Future implementations:
 *    http2, tcp
 * Internal Methods: camouflageMock - A generic function to handle all GRPC requests
 * @param {express.Application} app Express application to form the listener for http and https server
 * @param {number} port HTTP server port
 * @param {number} httpsPort HTTPs server port - currently initialized in constructor optionally but in future it'll be initialized if https is enabled
 * @param {string} grpcMocksDir location of grpc mocks, not initialized as constructor variable, because grpc is an optional protocol
 *                              instead it will be initialized in initGRPC method, if called.
 */
export default class Protocols {
  private app: express.Application;
  private port: number;
  private httpsPort: number;
  private grpcMocksDir: string;

  constructor(app: express.Application, port: number, httpsPort?: number) {
    this.app = app;
    this.port = port;
    this.httpsPort = httpsPort;
  }
  initHttp = (http: any): void => {
    http.createServer(this.app).listen(this.port, () => {
      logger.info(`Worker sharing HTTP server at http://localhost:${this.port} ⛳`);
      this.app.emit("server-started");
    });
  };
  initHttps = (https: any, key: string, cert: string) => {
    // If https is enabled, fetch key and cert information, create credentials and start the https server on specified port
    let privateKey = fs.readFileSync(key, "utf8");
    let certificate = fs.readFileSync(cert, "utf8");
    let credentials = { key: privateKey, cert: certificate };
    https.createServer(credentials, this.app).listen(this.httpsPort, () => {
      logger.info(`Worker sharing HTTPs server at https://localhost:${this.httpsPort} ⛳`);
    });
  };
  initGrpc = (grpcProtosDir: string, grpcMocksDir: string, grpcHost: string, grpcPort: number) => {
    // Set location of gRPC mocks to be used by private methid camouflageMock
    this.grpcMocksDir = grpcMocksDir;
    const grpcParser: GrpcParser = new GrpcParser(this.grpcMocksDir);
    // Get an array of all .protofile in specified protos directory
    const availableProtoFiles: string[] = fs.readdirSync(grpcProtosDir);
    // Initialize required variables
    let grpcObjects: grpc.GrpcObject[] = [];
    let packages: any = [];
    // Read and load package definition each protofile in protos dir
    availableProtoFiles.forEach((availableProtoFile) => {
      let packageDef = protoLoader.loadSync(path.join(grpcProtosDir, availableProtoFile), {});
      let definition = grpc.loadPackageDefinition(packageDef);
      grpcObjects.push(definition);
    });
    // For each definition, get the package details from all .proto files and store in a master packages object
    grpcObjects.forEach((grpcObject: grpc.GrpcObject) => {
      Object.keys(grpcObject).forEach((availablePackage) => {
        packages.push(grpcObject[`${availablePackage}`]);
      });
    });
    // Initialize a grpcServer
    const server = new grpc.Server();
    // Create an insecure binding to given grpc host and port, and start the server
    server.bindAsync(`${grpcHost}:${grpcPort}`, grpc.ServerCredentials.createInsecure(), (err) => {
      if (err) logger.error(err.message);
      logger.info(`Worker sharing gRPC server at ${grpcHost}:${grpcPort} ⛳`);
      server.start();
    });
    // For each package, filter out objects with service definition, discard rest
    packages.forEach((entry: any) => {
      let keys = Object.keys(entry);
      keys = keys.filter((key) => {
        return entry[key]["service"] !== undefined;
      });
      // For each method in the service definition, attach a generic handler, finally add service to running server
      // Handlers will vary based on the type of request, i.e. unary, bidi streams or one sided streams
      keys.forEach((key) => {
        let service = entry[key]["service"];
        let methods = Object.keys(service);
        let methodDefinition: Record<string, any> = {};
        methods.forEach((method) => {
          if (!service[method]["responseStream"] && !service[method]["requestStream"]) {
            logger.debug(`Registering Unary method: ${method}`);
            methodDefinition[method] = grpcParser.camouflageMock;
          }
          if (service[method]["responseStream"] && !service[method]["requestStream"]) {
            logger.debug(`Registering method with server side streaming: ${method}`);
            methodDefinition[method] = grpcParser.camouflageMockServerStream;
          }
          if (!service[method]["responseStream"] && service[method]["requestStream"]) {
            logger.debug(`Registering method with client side streaming: ${method}`);
            methodDefinition[method] = grpcParser.camouflageMockClientStream;
          }
          if (service[method]["responseStream"] && service[method]["requestStream"]) {
            logger.debug(`Registering method with BIDI streaming: ${method}`);
            methodDefinition[method] = grpcParser.camouflageMockBidiStream;
          }
        });
        server.addService(service, methodDefinition);
      });
    });
  };
  initHttp2 = (http2Port: number, http2key: string, http2cert: string) => {
    spdy
      .createServer(
        {
          key: fs.readFileSync(http2key),
          cert: fs.readFileSync(http2cert),
        },
        this.app
      )
      .listen(http2Port, (err: any) => {
        if (err) logger.error(err.message);
        logger.info(`Worker sharing HTTP2 server at https://localhost:${http2Port} ⛳`);
      });
  };
  initws = (wsPort: number, wsMockDir: string) => {
    const WebSocket = require("ws");
    const wss = new WebSocket.Server({ port: wsPort });
    logger.info(`Worker sharing WS server at ws://localhost:${wsPort} ⛳`);
    const websocketParser = new WebsocketParser(wss);
    wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
      const clientId = uuidv4();
      clients.push(clientId);
      // @ts-ignore
      ws["clientId"] = clientId;
      let mockFile = path.join(wsMockDir, ...request.url.substring(1).split("/"), "connection.mock");
      if (fs.existsSync(mockFile)) {
        websocketParser.sendConnect(ws, request, clients, clientId, "joining", mockFile);
      } else {
        websocketParser.sendConnect(ws, request, clients, clientId, "joining");
      }
      ws.on("message", (message) => {
        logger.debug(`Client sent message ${message}`);
        mockFile = path.join(wsMockDir, ...request.url.substring(1).split("/"), "message.mock");
        if (fs.existsSync(mockFile)) {
          websocketParser.send(mockFile, ws, request, message);
        } else {
          logger.error(`No suitable message.mock file found for ${request.url}`);
        }
      });
      ws.on("close", () => {
        clients.splice(clients.indexOf(clientId), 1);
        websocketParser.sendConnect(ws, request, clients, clientId, "leaving");
      });
    });
  };
}
