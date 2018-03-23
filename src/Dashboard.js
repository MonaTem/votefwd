// src/Dashboard.js

import React, { Component } from 'react';
import axios from 'axios';
import { VoterList } from './VoterList';
import { VoterOffer } from './VoterOffer';

class Dashboard extends Component {
  constructor(props) {
    super(props);

    this.handleAcceptedVoter = this.handleAcceptedVoter.bind(this);
    this.generatePDF = this.generatePDF.bind(this);
    this.state = { voters: [] }
  }

  getAdoptedVoters() {
    let user_id = localStorage.getItem('user_id');
    axios.get(`${process.env.REACT_APP_API_URL}/voters`,
      {
        params: { user_id: user_id }
      })
      .then(res => {
        this.setState( {voters: res.data} );
      })
      .catch(err => {
        console.error(err)
      });
  }

  generatePDF(voter) {
    axios.get(`${process.env.REACT_APP_API_URL}/voter/${voter.id}/letter`)
      .then(res => {
        voter.plea_letter_url = res.data;
        var voters = this.state.voters;
        voters.splice(-1, 1, voter);
        this.setState({ voters: voters });
      })
      .catch(err => {
        console.error(err);
      });
  }

  handleAcceptedVoter(voter) {
    this.setState({ voters: this.state.voters.concat([voter])});
    this.generatePDF(voter);
  }

  componentWillMount(){
    this.getAdoptedVoters()
  }

  render() {
    return (
      <div className="tc">
        <VoterOffer handleAccept={this.handleAcceptedVoter}/>
        <VoterList voters={this.state.voters}/>
      </div>
    );
  }
}

export default Dashboard
