// src/admin/AdminUser.js

import React, { Component } from 'react';
import axios from 'axios';
import moment from 'moment';
import { Header } from '../Header';
import { Footer } from '../Footer';
import download from 'js-file-download';
import ReactTable from 'react-table';
import 'react-table/react-table.css';

class AdminUser extends Component {
  constructor(props) {
    super(props)

    this.state = { voters: [], bundles: [], user: '', city: '', state: ''};
  }

  getUser(auth0_id) {
    axios({
      method: 'GET',
      headers: {Authorization: 'Bearer '.concat(localStorage.getItem('access_token'))},
      url: `${process.env.REACT_APP_API_URL}/user`,
      params: {
        auth0_id: auth0_id
      }
    })
    .then(res => {
      this.setState({ user: res.data[0] })
    })
    .then(res => {
      this.getAndSetLocation()
    })
    .catch(err => {
      console.error(err);
    });
  }

  getAndSetLocation() {
    axios({
      method: 'GET',
      headers: {Authorization: 'Bearer '.concat(localStorage.getItem('access_token'))},
      url: `${process.env.REACT_APP_API_URL}/lookup-zip-details`,
      params: { zip: this.state.user.zip }
    })
    .then(res => {
      this.setState({city: res.data[0].city, state: res.data[0].state});
    })
    .catch(err => {
      console.error(err);
    });
  }

  getAdoptedVoters(auth0_id) {
    let headers = {Authorization: 'Bearer '.concat(localStorage.getItem('access_token'))};
    axios.get(
      `${process.env.REACT_APP_API_URL}/voters`,
      {
        headers: headers,
        params: {
          user_id: auth0_id
        }
      })
      .then(res => {
        this.setState( {voters: res.data} );
      })
      .catch(err => {
        console.error(err)
      });
  }

  getBundles(auth0_id) {
    let headers = {Authorization: 'Bearer '.concat(localStorage.getItem('access_token'))};
    axios.get(
      `${process.env.REACT_APP_API_URL}/bundles`,
      {
        headers: headers,
        params: {
          user_id: auth0_id
        }
      })
      .then(res => {
        this.setState( {bundles: res.data} );
      })
      .catch(err => {
        console.error(err)
      });
  }

  downloadBundleForUser(auth0_id) {
    axios({
     method: 'GET',
      headers: {Authorization: 'Bearer '.concat(localStorage.getItem('access_token'))},
      url: `${process.env.REACT_APP_API_URL}/voters/downloadAllLettersForUser`,
      params: { user_id: auth0_id },
      responseType: "blob"
    })
    .then(res => {
      download(res.data, res.headers.filename);
    })
    .catch(err => {
      console.error(err);
    });
  }

  componentWillMount() {
    this.getUser(this.props.match.params.id);
    this.getAdoptedVoters(this.props.match.params.id);
    this.getBundles(this.props.match.params.id);
  }

  handleChangeStatus(user, newQualState, event) {
    event.preventDefault();
    if (this.state.user.qual_state === newQualState) {
      return;
    }
    axios({
      method: 'POST',
      headers: {Authorization: 'Bearer '.concat(localStorage.getItem('access_token'))},
      url: `${process.env.REACT_APP_API_URL}/s/updateUserQualifiedState`,
      data: {
        auth0_id: this.state.user.auth0_id,
        qualState: newQualState
      }
    })
    .then(res => {
      this.getUser(this.state.user.auth0_id);
    })
    .catch(err => {
      console.error(err);
    });
  }

  renderStatus(props) {
    const buttonClass = function buttonClass(state, qualState) {
      return "w-25 btn btn-light small" + (qualState === state ? ' active' : '');
    };

    const user = props.original;
    const qualState = this.state.user.qual_state;
    return (
      <div className="btn-group btn-group-toggle w-100">
        <label
          className={buttonClass('banned', qualState)}
          onClick={this.handleChangeStatus.bind(this, user, 'banned')}
        >
          <input type="radio" name="status" id="banned" autoComplete="off" /> B
        </label>
        <label
          className={buttonClass('pre_qualified', qualState)}
          onClick={this.handleChangeStatus.bind(this, user, 'pre_qualified')}
        >
          <input type="radio" name="status" id="prequal" autoComplete="off" /> P
        </label>
        <label
          className={buttonClass('qualified', qualState)}
          onClick={this.handleChangeStatus.bind(this, user, 'qualified')}
        >
          <input type="radio" name="status" id="qual" autoComplete="off" /> Q
        </label>
        <label
          className={buttonClass('super_qualified', qualState)}
          onClick={this.handleChangeStatus.bind(this, user, 'super_qualified')}
        >
          <input type="radio" name="status" id="superqual" autoComplete="off" /> S
        </label>
      </div>
    );
  }

  relinquish(adoptedAtEpoch, adopter, district) {
    let headers = {Authorization: 'Bearer '.concat(localStorage.getItem('access_token'))};
    axios.get(
      `${process.env.REACT_APP_API_URL}/voters/relinquish`,
      {
        headers: headers,
        params: {
          user_id: adopter,
          adopted_at: adoptedAtEpoch,
          district_id: district
        }
      })
      .then(res => {
        this.getBundles(this.props.match.params.id);
      })
      .catch(err => {
        console.error(err)
      });
  }

  renderBundleTable(bundles) {
    const columns = [{
      Header: 'District',
      accessor: 'district_id',
    },
    {
      id: 'aa',
      Header: 'Adopted At',
      accessor: aa => {
        return moment(aa.adopted_at)
          .local()
          .format("MM/DD, hh:mm a")
      }
    },
    {
      Header: 'Unprepped',
      accessor: 'unprepped_count',
    },
    {
      Header: 'Prepped',
      accessor: 'prepped_count',
    },
    {
      Header: 'Sent',
      accessor: 'sent_count',
    },
    {
      Header: 'Actions',
      accessor: "createdAt",
      Cell: props => {
        const { epoch,
                adopter_user_id,
                district_id,
                prepped_count,
                sent_count,
                unprepped_count} = props.original
        const show = parseInt(prepped_count, 10) === 0
                  && parseInt(sent_count, 10) === 0
                  && parseInt(unprepped_count, 10) > 0;
        if (!show) return null;
        return <button
          className="btn btn-small btn-success ml-2"
          onClick={this.relinquish.bind(this, epoch, adopter_user_id, district_id)}
        >
          Relinquish
        </button>
      },
    }]
    return (
      <div>
        <ReactTable
          minRows={0}
          showPagination={false}
          sortable={false}
          resizable={false}
          filterable={false}
          data={bundles}
          columns={columns}
          className="-striped -highlight"
        />
      </div>
    );
  }

  render() {
		let emailUrl = "mailto:" + this.state.user.email;
		let twitterUrl = "https://www.twitter.com/" + this.state.user.twitter_profile_url;
		let facebookUrl = "https://www.facebook.com/" + this.state.user.facebook_profile_url;
		let linkedinUrl = "https://www.linkedin.com/in/" + this.state.user.linkedin_profile_url;
		let statusButtons = this.renderStatus(this.props);
    const bundleRows = this.renderBundleTable(this.state.bundles);
    return (
      <React.Fragment>
      <Header auth={this.props.auth}/>
      <div className="container mb-4 mt-4">
        <div className="mb-4">
          <h4 className="mb-4">Basics</h4>

          <div>
            <p>
              <span className="mr-4">Full name:</span>
              {this.state.user.full_name}
            </p>
          </div>

          <div>
            <p>
              <span className="mr-4">Current district:</span>
              {this.state.user.current_district}
            </p>
          </div>

          <div>
            <p>
              <span className="mr-4">auth0 Id:</span>
              {this.state.user.auth0_id}
            </p>
          </div>

          <div>
            <p>
              <span className="mr-4">Created at:</span>
              <span>{moment(this.state.user.created_at).local().format("MM/DD, hh:mm a")}</span>
              <span className="ml-2">({moment(this.state.user.created_at).fromNow()})</span>
            </p>
          </div>

          <div>
            <p>
              <span className="mr-4">Updated at:</span>
              <span>{moment(this.state.user.updated_at).local().format("MM/DD, hh:mm a")}</span>
              <span className="ml-2">({moment(this.state.user.updated_at).fromNow()})</span>
            </p>
          </div>

          <div>
              <p>
                <span className="mr-4">Email address:</span>
                <a href={emailUrl}>{this.state.user.email}</a>
              </p>
          </div>

          <div>
            <p>
              <span className="mr-3">Twitter profile link: </span>
              <a href={twitterUrl} target="_blank">{this.state.user.twitter_profile_url}</a>
            </p>
          </div>

          <div>
              <p>
            <span className="mr-3">Facebook profile link:
            </span>
                <a href={facebookUrl} target="_blank">{this.state.user.facebook_profile_url}</a>
              </p>
          </div>

          <div>
              <p>
            <span className="mr-4">LinkedIn profile:
            </span>
                <a href={linkedinUrl} target="_blank">{this.state.user.linkedIn_profile_url}</a>
              </p>
          </div>

          <div>
              <p>
            <span className="mr-4">Location:
            </span>
                {this.state.city && <span>{this.state.city}, {this.state.state} </span>}
                {this.state.user.zip}
              </p>
          </div>

          <div>
              <p>
            <span className="mr-4">Why write letters:
            </span>
                {this.state.user.why_write_letters}
              </p>
          </div>
        </div>

        <div className="mb-4">
          <h4 className="mb-4">Bundles</h4>
          {bundleRows}
        </div>

        <div className="mb-4">
          <h4 className="mb-4">Voter Stuff</h4>
          <p>Adopted but not yet prepped: {this.state.voters.length}
            <button className="btn btn-small btn-success ml-2" onClick={() => this.downloadBundleForUser(this.state.user.auth0_id)}>Generate bundle</button>
          </p>
        </div>

        <div className="mb-4">
          <h4 className="mb-4">Qualification</h4>
          {statusButtons}
        </div>

      </div>
      <Footer />
      </React.Fragment>
    )}
}

export default AdminUser
