rxstore
----

[![Build Status](https://travis-ci.org/awaw00/react-inject-props.svg?branch=master)](https://travis-ci.org/awaw00/rxstore)
[![npm version](https://badge.fury.io/js/%40awaw00%2Frxstore.svg)](https://badge.fury.io/js/%40awaw00%2Frxstore)
[![Dependency Status](https://david-dm.org/awaw00/rxstore.svg)](https://david-dm.org/awaw00/rxstore)

Redux like but reactive and modularized state manage solution.

Redux风格的响应式模块化状态管理方案。

## 💾 Installation

`npm i @awaw00/rxstore rxjs inversify --save`

or

`yarn add @awaw00/rxstore rxjs inversify`

you should install the "reflect-metadata" package as well:

`npm i reflect-metadata --save` or `yarn add reflect-metadata`

## 🚀 Features

- ✅ 模块化store
- ✅ 可控的store作用域，Singleton or Transient
- ✅ 依赖注入
- ✅ 使用rx编写响应式代码

🎈 其它高级特性请查看下文中的[高级用法](#-advanced-usage)章节以及[最佳实践](#-best-practice)章节。

## 📋 Table of contents

- [Quick start](#-quick-start)
  - [准备工作](#准备工作)
  - [定义State接口](#定义state接口)
  - [编写Store类](#编写store类)
  - [绑定Store](#绑定store)
  - [使用Store](#使用store)
  - [Counter demo](#counter-demo)
- [Advanced usage](#-advanced-usage)
  - [Link service](#link-service)
  - [注入RxStore配置](#注入rxstore配置)
  - [Store合并](#store合并)
- [Best practice](#-best-practice)
  - [数据仓库模式](#数据仓库模式)
  - [配合react-inject-props使用](#配合react-inject-props使用)
  

## 🚩 Quick start

### 准备工作

下面将以[TypeScript-React-Starter](https://github.com/Microsoft/TypeScript-React-Starter)为起点，简单说明如何使用rxstore。

rxstore的store与store之间是相互独立的，但是**各store发出的action会在同一个“管道”（action流）中进行传输**，在定义store之前，我们需要先配置一个action管道。

在rxstore的底层，各store会通过依赖注入系统注入这个action管道。熟悉inversify的同学应该也了解，我们的项目会包含一个统一处理依赖关系的文件，我们将这个文件定为`src/ioc/index.ts`，然后编写如下代码：

```typescript
import { Container } from 'inversify';
import { Subject } from 'rxjs';
import { Action, tokens } from '@awaw00/rxstore';

const container = new Container();

container.bind(tokens.ActionStream).toConstantValue(new Subject<Action>());

export {
  container
};
```

上面的代码中，初始化了一个Subject作为action的管道，并使用rxstore暴露出来的tokens将其绑定到了container中。

### 定义State接口

新建文件`src/stores/CounterStore.ts`，我们开始进行Store的编写。

编写store的第一步，就是思考store中需要保存什么结构的状态了，然后将其定义为一个state接口：

```typescript
export interface CounterState {
  count: number;
}
```

### 编写Store类

有了状态接口之后，就可以着手编写store的实现了。

首先，定义一个继承于RxStore的类，并将`CounterState`作为泛型参数传入：

```typescript
import { RxStore } from '@awaw00/rxstore';

export interface CounterState {
  count: number;
}

export class CounterStore extends RxStore<CounterState> {
  
}
```

接着，可以为store定义actionType了。

使用rxstore提供的`typeDef`和`asyncTypeDef`装饰器，可以方便又优雅地定义actionType：

```typescript
import { RxStore, typeDef, asyncTypeDef, ActionType, AsyncActionType } from '@awaw00/rxstore';


export class CounterStore extends RxStore<CounterState> {
  @typeDef() public INCREASE!: ActionType;
  @typeDef() public DOUBLE_INCREASE!: ActionType;
  
  @asyncTypeDef() public DOUBLE_ASYNC!: AsyncActionType;
}
```

上面定义了3个type：两个ActionType以及一个AsyncActionType。

在基类RxStore的构造方法中，会对使用了`typeDef`以及`asyncTypeDef`装饰器的字段进行自动赋值，比如`this.INCREASE`会被赋值为`Symbol('INCREASE')`，而`this.DOUBLE_ASYNC`会被赋值为：

```typescript
INCREASE_ASYNC = {
  START: Symbol('DOUBLE_ASYNC/START'),
  END: Symbol('DOUBLE_ASYNC/END'),
  ERR: Symbol('DOUBLE_ASYNC/ERR'),
}
```

然后我们需要使用`this.init`方法，设置store的initialState以及reducer：

```typescript
import { postConstruct } from 'inversify';
...
export class CounterStore extends RxStore<CounterState> {
  @postConstruct()
  private storeInit () {
    this.init({
      initialState: {
        count: 0
      },
      reducer: (state, {type, payload}) => {
        switch (type) {
          case this.INCREASE:
            return {...state, count: state.count + payload};
          default:
            return state;
        }
      },
    });
  }
}
```

> 为什么要使用postConstructor装饰器？  
>
> rxstore使用inversify管理依赖关系，并且在基类RxStore中使用了property inject的方式来注入一些外部依赖（比如action$），在构造方法执行时，inversify并不能为我们准备好这些依赖对象。  
>
> 使用postConstructor可以确保所有依赖都已就绪后再执行store的初始化操作。

最后，还需要为store定义处理副作用的effects，以及action creators：

```typescript
import { effect, ofType } from '@awaw00/rxstore';
import { withLatestFrom, mapTo, of, switchMap } from 'rxjs/operators';

export class CounterStore extends RxStore<CounterState> {
  ...
  public increase = (count: number) => ({
    type: this.INCREASE,
    payload: count,
  });

  public doubleIncrease = () => ({
    type: this.DOUBLE_INCREASE,
  });

  public asyncDouble = (after: number) => ({
    type: this.DOUBLE_ASYNC.START,
    payload: {
      after,
    },
  });


  @effect()
  private onDoubleIncrease () {
    return this.action$.pipe(
      ofType(this.DOUBLE_INCREASE),
      withLatestFrom(this.state$, (action, state) => state.count),
      map((count: number) => this.increase(count)),
    );
  }

  @effect()
  private onAsyncDouble () {
    return this.action$.pipe(
      ofType(this.DOUBLE_ASYNC.START),
      switchMap((action) => of(action).pipe(
        delay(action.payload.after),
        mapTo(this.doubleIncrease()),
      )),
    );
  }
}
```

### 绑定store

完成store的实现之后，不要忘记在container绑定store：

`src/ioc/index.ts`

```typescript
import { CounterStore } from '../stores/CounterStore';
...
container.bind(CounterStore).toSelf().inSingletonScope();
...
```

### 使用store

完成了counter store的编写后，就可以开始获取并使用store了。

新增Counter组件`src/components/Counter.tsx`，并编写如下代码：

```typescript
iimport React from 'react';
 import { CounterState, CounterStore } from '../stores/CounterStore';
 
 interface Props {
   store: CounterStore;
 }
 
 export class Counter extends React.Component<Props, CounterState> {
   private readonly subscription: { unsubscribe: () => any };
 
   constructor (props: Props) {
     super(props);
 
     this.subscription = props.store.state$.subscribe(state => {
       if (this.state) {
         this.setState(state);
       } else {
         this.state = state;
       }
     });
   }
 
   public componentWillUnmount () {
     // 不要忘记移除监听
     this.subscription.unsubscribe();
   }
 
   public increase = () => {
     const {store} = this.props;
     store.dispatch(store.increase(1));
   };
 
   public doubleIncrease = () => {
     const {store} = this.props;
     store.dispatch(store.doubleIncrease());
   };
 
   public asyncDouble = () => {
     const {store} = this.props;
     store.dispatch(store.asyncDouble(2000));
   };
 
   public render () {
     const {count} = this.state;
     return (
       <div>
         <p>Counter: {count}</p>
         <p>
           <button onClick={this.increase}>INCREASE</button>
           <button onClick={this.doubleIncrease}>DOUBLE</button>
           <button onClick={this.asyncDouble}>DOUBLE ASYNC</button>
         </p>
       </div>
     );
   }
 }
```

在`src/App.tsx`中，获取store并传入Counter组件：

```typescript
import * as React from 'react';
import { container } from './ioc';
import { CounterStore } from './stores/CounterStore';
import { Counter } from './components/Counter';

const store = container.get(CounterStore);

class App extends React.Component {
  public render() {
    return (
      <div className="App">
        <Counter store={store}/>
      </div>
    );
  }
}

export default App;
```

启动项目，大功告成！

### Counter demo

查看[在线DEMO](https://awaw00.github.io/rxstore/counter/)，查看[完整代码](https://github.com/awaw00/rxstore/tree/master/examples/counter)。

## 💎 Advanced usage

### Link Service

开发一个web项目，一定少不了与后端数据接口做交互。

通常情况下，我们可以编写一个这样的effect来处理接口请求和响应：

```typescript
interface State {
  dataState: {
    loading: boolean;
    data: any | null;
    err: any | null;
  };
}

@injectable()
class Store extends RxStore<State> {
  @asyncTypeDef() public GET_DATA!: AsyncActionType;
  
  @inject(Service)
  private service: Service;
  
  @postConstruct()
  private storeInit () {
    this.init({
      initialState: {
        dataState: {
          loading: false,
          data: null,
          err: null
        },
      },
      reducer: (state, action) => {
        switch (action.type) {
          case this.GET_DATA.START: {
            return {...state, dataState: {...state.dataState, loading: true}};
          }
          case this.GET_DATA.END: {
            return {...state, dataState: {...state.dataState, loading: false, data: action.payload}};
          }
          case this.GET_DATA.ERR: {
            return {...state, dataState: {...state.dataState, loading: false, err: action.payload}};
          }
          default:
            return state;
        }
      }
    });
  }
  
  @effect()
  private onGetData () {
    return this.action$.pipe(
      ofType(this.GET_DATA.START),
      switchMap((action) => this.service.getData(action.payload).pipe(
        map(res => ({type: this.GET_DATA.END, payload: res})),
        catchError(err => of({type: this.GET_DATA.ERR, payload: err})),
      )),
    );
  }
}
```

上面的代码看起来还ok，通过`this.GET_DATA.START`的action及其带上的payload作为参数发起请求，并且对接口的loading以及error状态都做了处理。

但是如果按这样的写法来构建一个中大型的应用，你一定会抓狂的：数十个接口，每个接口都需要这样几乎没有区别的十几行代码来处理。

为了简化store与接口的对接，基类RxStore提供了一个`linkService`方法，这个方法接受一个`LinkServiceConfig<State>`对象作为参数，其定义为：

```typescript
export interface LinkServiceConfig<S> {
  type: AsyncActionType;
  service: (...args: any[]) => Observable<any>;
  state: keyof S;
  dataSelector?: (payload: any) => any;
  errorSelector?: (payload: any) => any;
}
```

我们试试用它来改写上面的代码：

```typescript
import { AsyncState, getInitialAsyncState } from '@awaw00/rxstore';

interface State {
  dataState: AsyncState;
}

@injectable()
class Store extends RxStore<State> {
  @asyncTypeDef() public GET_DATA!: AsyncActionType;
  
  @inject(Service)
  private service: Service;
  
  @postConstruct()
  private storeInit () {
    this.linkService({
      type: this.GET_DATA,
      service: this.service.getData.bind(this.service),
      state: 'dataState'
    });
    
    this.init({
      initialState: {
        dataState: getInitialAsyncState()
      },
      reducer: (state, action) => {
        return state;
      }
    });
  }
}
```

新代码实现了与旧代码相同的功能，看起来是否清爽了很多呢？_`getInitialAsyncState`方法用于快速构建一个初始的异步状态对象。_

**注意`linkService`方法需要在`init`方法之前调用。**

`LinkStoreConfig`接口中还有两个可选字段：`dataSelector`以及`errorSelector`。

我们可以使用这两个字段来控制如何从异步方法的返回值或者抛出的错误转换成store中AsyncState.data或AsyncState.err。

比如有如下的一个FakeService：

```typescript
@injectable()
export class FakeService {
  public getData () {
    return of({data: {name: 'awaw00', email: 'awaw0618#outlook.com'}}).pipe(delay(1000));
  }
}
```

使用不带dataSelector的linkState后，会在store中保存整个结构为{data: {name: string; email: string}}的返回值。

如果我们只想要保存data字段中的值{name: 'xxx', email: 'xxx'}，就需要指定一个dataSelector：

```typescript
this.linkState({
  type: this.GET_DATA,
  service: this.fakeService.getData.bind(this.fakeService),
  state: 'data',
  dataSelector: payload => payload.data
});
```

errorSelector的用法与dataSelector类似。

此外，我们还可以通过[注入RxStore配置](#注入rxstore配置)来修改默认的dataSelector与errorSelector。

### 注入RxStore配置

RxStore支持在外部注入一些配置来修改某些默认行为。

注入配置的方法：

1. 编写配置

```typescript
import { RxStoreConfig } from '@awaw00/rxstore';

export class CustomRxStoreConfig implements RxStoreConfig {
  
}
```

2. 注入自定义配置

```typescript
...
import { tokens } from '@awaw00/rxstore';
import { CustomRxStoreConfig } from '../configs/CustomRxStoreConfig';

...
container.bind(tokens.RxStoreConfig).to(CustomRxStoreConfig).inSingletonScope();
...
```

可配置项可见`RxStoreConfig`的接口定义：
```typescript
export interface BaseConfigLinkService {
  dataSelector?: (payload: any) => any; // 配置linkService时默认的dataSelector
  errorSelector?: (payload: any) => any; // 配置linkService时默认的errorSelector
}

export interface RxStoreConfig {
  linkService?: BaseConfigLinkService;
}
```

### Store合并

假设现在有两个Store：UserInfoStore、UserPageStore。

其中，UserInfoStore用于维护当前登录用户的相关信息数据，而UserPageStore用于维护渲染用户中心页面所需的状态。

通常情况下，UserPageStore中的状态与UserInfoStore中的状态应该会有一个包含关系（比如两者的state都包含一个代表用户昵称的nickName字段），这里可以有两种选择：

1. 将UserInfoStore中的某些状态“合并”到UserPageStore中，类似vue、mobx中的computed
2. 两个store通过调用service方法获取并维护各自的数据

显而易见的，**选项1更为优秀**，产出的代码一定会让我们觉得更加赏心悦目。依托rxjs基于流的优秀设计，我们可以很轻易地实现方案1中的状态合并：

```typescript
// src/stores/UserInfoStore.ts

export interface UserInfoState {
  id: string;
  nickName: string;
}

export class userStore extends RxStore<UserInfoState> {
  ...
}
```

```typescript
// src/stores/UserPageStore.ts

import { UserInfoStore, UserInfoState } from './UserInfoStore';

export interface UserPageState {
  userInfo: UserInfoState;
  // ... other state
}

export class UserPageStore extends RxStore<UserPageState> {
  @inject(UserInfoStore)
  private userInfoStore: UserInfoStore;
  
  @postConstruct()
  private storeInit () {
    this.init({
      initialState: {
        userInfo: this.userInfoStore.options.initialState,
        // ...other state
      },
      reducer: (state, action) => {
        // update own state
        return state;
      }
    });
    
    // combine state from UserInfoStore
    this.state$ = combineLatest(
      this.state$,
      this.userInfoStore.state$,
    ).pipe(
      map(([selfState, userInfoState]) => ({
        ...selfState,
        userInfo: userInfoState
      })),
    );
  }
}
```

合并之后，当UserInfoStore中的状态发生了变更，UserPageStore的状态也会自动更新了。

store合并可以让我们实现[数据仓库模式](#数据仓库模式)，使我们的代码更易于维护、数据流更加清晰。

## ✨ Best practice

### 数据仓库模式

这里的“数据”指的是通过rest api、webSocket等方式从服务端获取到的数据。

我们应用中大部分代码都在于这些数据或衍生数据进行交互，这些代码的质量会在很大程度上影响整个项目的质量。

这里提出一种数据仓库模式：**所有此类数据，根据功能或类型划分整理为数据store，其他依赖这些数据的store以store合并的方式注入这些数据。**

比如，要实现一个电商系统，我们先把“商品”相关的接口封装在一个ProductService中：

```typescript
// src/services/ProductService.ts

import { Http } from './Http'

@injectable()
export class ProductService {
  @inject(Http)
  private http: Http;
  
  public getProductList (params: GetProductParams) {
    return this.http.get<Pagable<ProductListItem>>('/product/list', {params});
  }
  
  public getProductDetail (params: GetProductDetailParams) {
    return this.http.get<ProductDetail>('/product/detail', {params});
  }
  
  // other api definitions...
}
```

然后编写一个ProductDataStore，使用linkService来接入商品接口：

```typescript
// src/stores/ProductDataStore.ts
import { injectable, inject, postConstructor } from 'inversify';
import { RxStore, getInitialAsyncState, AsyncState, AsyncActionType, asyncTypeDef } from '@awaw00/rxstore';
import { ProductService } from '../services/ProductService';

export interface ProductDataState {
  productList: AsyncState<Pageable<ProductListItem>>;
  productDetail: AsyncState<ProductDetail>;
  // ...
}

@injectable()
export class ProductDataStore extends RxStore<ProductDataState> {
  @asyncTypeDef() public GET_PRODUCT_LIST!: AsyncActionType;
  @asyncTypeDef() public GET_PRODUCT_DETAIL!: AsyncActionType;
  
  @inject(ProductService)
  private productService: ProductService;
  
  @postConstructor()
  private storeInit () {
    this.linkService({
      type: this.GET_PRODUCT_LIST.START,
      service: this.productService.getProductList.bind(this),
      state: 'productList'
    });
    
    this.linkService({
      type: this.GET_PRODUCT_DETAIL.START,
      service: this.productService.getProductDetail.bind(this),
      state: 'productDetail'
    });
    
    // ...
    this.init({
      initialState: {
        productList: getInitialAsyncState(),
        productDetail: getInitialAsyncState(),
      },
      reducer: state => state
    });
  }
}
```

最后，在其他需要使用商品数据的store中，使用[store合并](#store合并)的方式来注入所需的数据。

若数据store中的数据是全局唯一的，可以将数据store注册为单例，比如UserDataStore：

```typescript
// src/ioc/index.ts
...
import { UserDataStore } from '../stores/UserDataStore';

container.bind(UserDataStore).toSelf().inSingletonScope();
```

像商品这样的数据，也许会存在一个页面包含两个或更多个商品列表的场景，每个列表的数据应该是独立的，应该注册为临时性的“瞬态”（Transient）：

```typescript
...
import { ProductDataStore } from '../stores/ProductDataStore';

container.bind(ProductDataStore).toSelf().inTransientScope();
```

搭配[react-inject-props](https://github.com/awaw00/react-inject-props)，可以更容易地管理依赖注册的作用域，详见[配合react-inject-props](#配合react-inject-props)章节。

### 配合react-inject-props使用

想要在react应用中使用rxstore，react-inject-props是最好的搭档。

使用react-inject-props，可以这样将store注入到组件中：

```typescript
import React from 'react';
import { UserPageStore, UserPageState } from '../stores/UserPageStore';
import { InjectProps } from '../ioc';

interface PageProps {
  store?: UserPageStore;
}

type PageState = UserPageState;

@InjectProps({
  store: UserPageStore
})
export class UserPage extends React.Component<PageProps, PageState> {
 private readonly subscription: { unsubscribe: () => any };
  constructor (props: PageProps) {
    super(props);
    
    this.subscription = props.store!.state$.subscribe(state => {
      if (this.state) {
        this.setState(state);
      } else {
        this.state = state;
      }
    });
  }
  
  public componentWillUnmount () {
    this.subscription.unsubscribe();
  }
  
  public render () {
    const {userInfo, ...} = this.state;
    ...
  }
}
```

除了提供必要的依赖注入支持之外，它还可以用来实现多级注入系统（使用过Angular的同学应该很熟悉）。

下面的例子展示了如何使用多级注入系统替换默认的store实现。

如果我们的App结构如下：

```jsx harmony
<App>
  <Router>
    <Route path="/user/common" component={UserPage}/>
    <Route
      path="/user/special"
      render={(
        <SpecialUserInfoProvider>
          <UserPage/>
        </SpecialUserInfoProvider>
      )} 
    />
  </Router>
</App>
```

UserPage组件需要注入UserPageStore，而UserPageStore中需要合并UserInfoStore的状态，我们在根container已经注入了默认的UserInfoStore单例。

现在的需求是，当进入路由为`/user/special`的页面时，其他实现保持原样，但是所展现的用户信息需要从另外的接口中获取，这时候就可以这样实现`SpeciapUserInfoProvider`组件：

```typescript
import { ProvideProps } from '../ioc';
import { UserInfoStore } from '../stores/UserInfoStore';
import { SpecialUserInfoStore } from '../stores/SpecialUserInfoStore';

@ProvideProps([
  {provide: UserInfoStore, useClass: SpecialUserInfoStore}
])
export class SpecialUserInfoProvider extends React.Component {
  public render () {
    return this.props.children;
  }
}
```

只要确保SpecialUserInfoStore的状态结构以及提供的方法应与UserInfoStore保持一致，那么`/user/special`路由下的UserPage组件就能够正确渲染出来，而不需要在UserPage组件的实现上做任何修改。

## License

MIT


