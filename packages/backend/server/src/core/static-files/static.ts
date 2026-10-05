import { join } from 'node:path';

import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Application, Request, Response } from 'express';
import { static as serveStatic } from 'express';

import { Config } from '../../base';

const staticPathRegex = /^\/(_plugin|assets|imgs|js|plugins|static)\//;

function isMissingStaticAssetError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as { code?: string; status?: number; statusCode?: number };

  return err.code === 'ENOENT' || err.status === 404 || err.statusCode === 404;
}

@Injectable()
export class StaticFilesResolver implements OnModuleInit {
  constructor(
    private readonly config: Config,
    private readonly adapterHost: HttpAdapterHost
  ) {}

  onModuleInit() {
    if (!this.adapterHost.httpAdapter) {
      return;
    }

    const app = this.adapterHost.httpAdapter.getInstance<Application>();
    const basePath = this.config.server.path;
    const rootPath = basePath || '/';
    const staticPath = join(env.projectRoot, 'static');
    const adminPath = join(staticPath, 'admin');

    const staticAsset = serveStatic(staticPath, {
      redirect: false,
      index: false,
      fallthrough: true,
    });
    const staticAssetStrict = serveStatic(staticPath, {
      redirect: false,
      index: false,
      fallthrough: false,
    });
    const adminAsset = serveStatic(adminPath, {
      redirect: false,
      index: false,
      fallthrough: true,
    });


    // /admin
    app.use(basePath + '/admin', adminAsset);
    app.get([basePath + '/admin', basePath + '/admin/*path'], (_req, res) => {
      res.sendFile(join(adminPath, 'index.html'));
    });

    // /_plugin|/assets|/imgs|/js|/plugins|/static
    app.use(rootPath, (req, res, next) => {
      if (!staticPathRegex.test(req.path)) {
        next();
        return;
      }
      staticAssetStrict(
        req,
        res,
        error => {
          if (isMissingStaticAssetError(error)) {
            res.status(404).end();
            return;
          }
          next(error);
        }
      );
    });

    // /
    app.use(rootPath, (req, res, next) => {
      if (req.path.startsWith('/admin')) {
        next();
        return;
      }

      res.setHeader(
        'Cache-Control',
        'private, no-cache, no-store, max-age=0, must-revalidate'
      );
      staticAsset(req, res, next);
    });

    app.get(
      [basePath || '/', basePath + '/*path'],
      (req: Request, res: Response) => {
        if (req.path.startsWith('/admin')) {
          res.status(404).end();
          return;
        }

        res.sendFile(join(staticPath, 'index.html'));
      }
    );
  }
}
