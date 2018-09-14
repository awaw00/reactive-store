import { merge, Observable, of, Subject } from 'rxjs';
import { catchError, distinctUntilChanged, scan, shareReplay, switchMap, tap } from 'rxjs/operators';
import { inject, injectable, optional } from 'inversify';
import { asyncTypeDefNamesKey, effectNamesKey, typeDefNamesKey } from './metadataKeys';
import { Action, AsyncState, LinkServiceConfig, RxStoreConfig, RxStoreInitOptions } from './interfaces';
import { isLinkServiceConfig } from './utils';
import * as tokens from './tokens';
import { ofType } from './operators';

@injectable()
export abstract class RxStore<S extends object = any> {
  public state$!: Observable<S>;
  public options!: RxStoreInitOptions<S>;

  @inject(tokens.ActionStream)
  protected action$!: Subject<Action>;
  private unsubscriber!: { unsubscribe: () => void };
  private serviceNeedLinkConfigs: LinkServiceConfig<S>[] = [];

  constructor () {
    this.setTypesValue();
    this.setAsyncTypesValue();
  }

  @inject(tokens.RxStoreConfig)
  @optional()
  private _storeConfig?: RxStoreConfig;

  public get storeConfig (): RxStoreConfig {
    const configLinkService = this._storeConfig ? this._storeConfig.linkService : {};
    return {
      linkService: {
        dataSelector: payload => payload,
        errorSelector: payload => payload,
        ...configLinkService,
      },
    };
  }

  public dispatch<T = any> (action: Action<T>) {
    this.action$.next(action);
  }

  public destroy () {
    if (this.unsubscriber) {
      this.unsubscriber.unsubscribe();
    }
  }

  protected linkService (linkServiceConfig: LinkServiceConfig<S>) {
    this.serviceNeedLinkConfigs.push(linkServiceConfig);
  }

  protected init (options: RxStoreInitOptions<S>) {
    this.options = options;
    const {linkService: configLinkService} = this.storeConfig;

    const reducer = (state: S, action: Action) => {
      for (const config of this.serviceNeedLinkConfigs) {
        const {state: stateKey, type: asyncType, dataSelector, errorSelector} = config;

        const finalDataSelector = dataSelector || configLinkService!.dataSelector!;
        const finalErrorSelector = errorSelector || configLinkService!.errorSelector!;

        const {type, payload} = action;

        switch (type) {
          case asyncType.START:
          case asyncType.END:
          case asyncType.ERR: {
            const asyncState = {...(state[stateKey] as any)} as AsyncState;

            switch (type) {
              case asyncType.START: {
                asyncState.loading = true;
                asyncState.err = null;
                break;
              }
              case asyncType.END: {
                asyncState.loading = false;
                asyncState.data = finalDataSelector(payload);
                break;
              }
              case asyncType.ERR: {
                asyncState.loading = false;
                asyncState.err = finalErrorSelector(payload);
                break;
              }
            }

            state = {...(state as any), [stateKey]: asyncState} as S;
          }
        }
      }

      return this.options.reducer(state, action);
    };

    this.state$ = this.action$.pipe(
      scan(reducer, this.options.initialState),
      distinctUntilChanged(),
      shareReplay(1),
    );

    const effectNames = Reflect.getMetadata(effectNamesKey, this);
    const effectMethodNames = effectNames ? effectNames.split('|') : [];

    const effects: Array<Observable<Action>> = [];
    for (const name of effectMethodNames) {
      effects.push((this as any)[name]());
    }

    for (const config of this.serviceNeedLinkConfigs) {
      if (isLinkServiceConfig(config)) {
        effects.push(this.action$.pipe(
          ofType(config.type.START),
          switchMap(({payload}) => config.service(payload).pipe(
            tap((res) => this.dispatch({type: config.type.END, payload: res})),
            catchError((err) => of(err).pipe(
              tap(() => this.dispatch({type: config.type.ERR, payload: err})),
            )),
          )),
        ));
      } else {
        console.error('invalid service link config:', config);
      }
    }

    const actionWithEffects$ = merge(...effects);

    const withEffect$ = merge(
      this.state$,
      actionWithEffects$,
    );

    this.unsubscriber = withEffect$.subscribe();
    this.dispatch({type: Symbol('@@INIT')});
  }

  private setTypesValue () {
    const typeNamesStr = Reflect.getMetadata(typeDefNamesKey, this) || '';
    const typeNames = typeNamesStr.split('|');

    for (const name of typeNames) {
      (this as any)[name] = Symbol(name);
    }
  }

  private setAsyncTypesValue () {
    const asyncTypeNamesStr = Reflect.getMetadata(asyncTypeDefNamesKey, this) || '';
    const asyncTypeNames = asyncTypeNamesStr.split('|');

    for (const name of asyncTypeNames) {
      (this as any)[name] = {
        START: Symbol(`${name}/START`),
        END: Symbol(`${name}/END`),
        ERR: Symbol(`${name}/ERR`),
      };
    }
  }
}
